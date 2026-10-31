import {
  MAX_TOTAL_FILE_SIZE,
  type DocumentAttachmentCommit,
  type DocumentUpdateResponse,
  type ExpirationPreset,
  type UploadSignFileItem,
  type UploadSignFileResponseItem,
} from '@patto-md/shared';
import { requestUploadSign, uploadToR2, updateDocument } from './client';
import {
  getBasename,
  replaceMarkdownImageUrls,
  extractDescription,
  parseMarkdown,
  reconcileAssets,
  type ResolvedAsset,
} from '../markdown';
import { resolveFileMimeType } from './publish';

/** 更新パイプラインの進行進捗情報の定義。 */
export interface UpdateProgressInfo {
  /** 進行ステージ。 */
  stage: 'signing' | 'uploading' | 'committing';
  /** 完了件数。 */
  current: number;
  /** 全体件数。 */
  total: number;
  /** ユーザー向けの進捗メッセージ。 */
  message: string;
  /** 進捗割合 (0〜100)。 */
  percent: number;
}

/** 既存添付ファイル情報の定義。 */
export interface ExistingAttachmentItem {
  /** 添付ファイルID。 */
  id: string;
  /** 元のファイル名。 */
  fileName: string;
  /** ファイルサイズ(バイト)。 */
  fileSize: number;
  /** MIMEタイプ。 */
  mimeType: string;
  /** R2オブジェクトキー。 */
  r2Key: string;
}

/** ドキュメント更新実行パラメータの定義。 */
export interface ExecuteUpdatePipelineParams {
  /** ドキュメントID(`Slug`)。 */
  documentId: string;
  /** 認可トークン(`edit` または `modify` トークン)。 */
  token: string;
  /** 編集後のタイトル文字列。 */
  title: string;
  /** 編集後のMarkdownテキスト文字列。 */
  markdownContent: string;
  /** 維持する既存の添付ファイル一覧。 */
  existingAttachments: ExistingAttachmentItem[];
  /** 新規に追加された画像ファイル群。 */
  newFiles?: File[];
  /** 有効期限プリセット(任意)。未指定時は既存アセットから推測または既定値が適用される。 */
  expiration?: ExpirationPreset;
  /** 未解決画像のリンク切れ更新を容認するかどうかの真偽値。 */
  allowIncompletePublish?: boolean;
  /** Cloudflare Turnstile ボット検証トークン。 */
  turnstileToken?: string;
  /** 接続先APIベースURL。 */
  baseUrl?: string;
  /** 進捗コールバックハンドラー。 */
  onProgress?: (progress: UpdateProgressInfo) => void;
}

/**
 * Direct Uploadおよびドキュメント更新コミットのパイプラインを実行する。
 *
 * 次の一連の処理を実行する。
 * 1. Markdown本文のAST解析および新規画像参照の突合。
 * 2. 新規追加画像群および更新後Markdown本文の一括署名取得 (`POST /api/upload/sign`)。
 * 3. 本文中の新規画像URLを永続パス (`/api/assets/${r2Key}`) へ一括置換。
 * 4. 新規画像および更新後Markdown本文のR2直接アップロード (Direct PUT)。
 * 5. 既存アセットと新規アセットを統合したメタデータの更新コミット (`PUT /api/documents/:id`)。
 *
 * @param params - 更新実行パラメータ。
 * @returns ドキュメント更新レスポンス。
 */
export async function executeUpdatePipeline(
  params: ExecuteUpdatePipelineParams,
): Promise<DocumentUpdateResponse> {
  const {
    documentId,
    token,
    title,
    markdownContent,
    existingAttachments,
    newFiles = [],
    allowIncompletePublish = false,
    turnstileToken,
    baseUrl,
    onProgress,
  } = params;

  const normalizedTitle = title.trim();
  if (normalizedTitle.length === 0) {
    throw new Error('タイトルが入力されていません。');
  }

  if (markdownContent.trim().length === 0) {
    throw new Error('Markdown本文が入力されていません。');
  }

  /** 既存添付ファイルと新規追加ファイルの合計サイズ(バイト)。 */
  const totalAttachmentSize =
    existingAttachments.reduce((sum, att) => sum + att.fileSize, 0) +
    newFiles.reduce((sum, file) => sum + file.size, 0);

  if (totalAttachmentSize > MAX_TOTAL_FILE_SIZE) {
    throw new Error('添付ファイルの合計サイズが上限(30MB)を超過しています。');
  }

  /** Markdown構文木の解析結果。 */
  const parseResult = await parseMarkdown(markdownContent);
  const imageRefs = parseResult.imageRefs;

  /** 既存の配信パス(`/api/assets/`)および既存アセットを除外した新規画像参照リスト。 */
  const newImageRefs = imageRefs.filter((ref) => {
    const rawUrl = ref.rawUrl.trim();
    if (rawUrl.startsWith('/api/assets/')) {
      return false;
    }
    if (existingAttachments.some((att) => rawUrl.includes(att.r2Key))) {
      return false;
    }
    return true;
  });

  /** 新規追加画像の仮想ファイルリスト。 */
  const virtualFiles = newFiles.map((file) => ({
    file,
    relativePath: file.name,
    isSizeExceeded: false,
    isTypeUnsupported: false,
  }));

  /** 新規画像参照と仮想ファイルの突合結果。 */
  const reconciliation = reconcileAssets(newImageRefs, virtualFiles);
  if (!reconciliation.isComplete && !allowIncompletePublish) {
    throw new Error('未解決の新規追加画像が存在します。');
  }

  /** 重複を排除した解決済み新規画像リスト。 */
  const uniqueResolvedAssets: ResolvedAsset[] = [];
  const seenRelativePaths = new Set<string>();

  for (const asset of reconciliation.resolved.values()) {
    if (!seenRelativePaths.has(asset.relativePath)) {
      seenRelativePaths.add(asset.relativePath);
      uniqueResolvedAssets.push(asset);
    }
  }

  onProgress?.({
    stage: 'signing',
    current: 0,
    total: uniqueResolvedAssets.length + 1,
    message: '署名を発行中...',
    percent: 10,
  });

  /** 新規画像群および更新後本文Markdownの一括署名発行アイテムリスト。 */
  const fileSignItems: UploadSignFileItem[] = [
    ...uniqueResolvedAssets.map((asset) => {
      const fileName =
        getBasename(asset.relativePath) || asset.file.name || 'image';
      return {
        name: fileName,
        size: asset.file.size,
        type: resolveFileMimeType(asset.file),
      };
    }),
    {
      name: 'content.md',
      size: new Blob([markdownContent]).size,
      type: 'text/markdown',
    },
  ];

  /** 明示指定または既存添付ファイルのキーから推測した有効期限プリセット。 */
  let resolvedExpiration: ExpirationPreset | undefined = params.expiration;
  if (!resolvedExpiration && existingAttachments.length > 0) {
    const sampleKey = existingAttachments[0].r2Key;
    if (sampleKey.startsWith('exp-1d/')) {
      resolvedExpiration = '1day';
    } else if (sampleKey.startsWith('exp-7d/')) {
      resolvedExpiration = '7days';
    } else if (sampleKey.startsWith('exp-30d/')) {
      resolvedExpiration = '30days';
    } else if (sampleKey.startsWith('permanent/')) {
      resolvedExpiration = 'never';
    }
  }

  const signResponse = await requestUploadSign(
    fileSignItems,
    baseUrl,
    turnstileToken,
    resolvedExpiration,
  );
  const signedFiles = signResponse.files;

  /** 本文Markdown用の署名情報。 */
  const markdownSign = signedFiles[signedFiles.length - 1];

  /** 新規画像ごとの署名情報マップ。 */
  const assetSignMap = new Map<string, UploadSignFileResponseItem>();
  uniqueResolvedAssets.forEach((asset, index) => {
    assetSignMap.set(asset.relativePath, signedFiles[index]);
  });

  /** 本文内の新規画像参照を永続パス(`/api/assets/${r2Key}`)へ置換するためのマップ。 */
  const urlMap = new Map<string, string>();
  for (const [cleanPath, resolvedAsset] of reconciliation.resolved.entries()) {
    const sign = assetSignMap.get(resolvedAsset.relativePath);
    if (sign) {
      urlMap.set(cleanPath, `/api/assets/${sign.r2Key}`);
    }
  }

  /** 新規画像参照が永続パスへ置換されたMarkdown本文。 */
  const replacedMarkdown = replaceMarkdownImageUrls(
    markdownContent,
    newImageRefs,
    urlMap,
  );

  /** R2ストレージへ直接PUT送信するMarkdown本文Blob実体。 */
  const replacedBlob = new Blob([replacedMarkdown], {
    type: 'text/markdown; charset=utf-8',
  });

  /** R2ストレージへの並列Direct PUTアップロードタスク一覧。 */
  const uploadTasks: {
    name: string;
    uploadUrl: string;
    body: Blob | File;
    mimeType: string;
  }[] = [
    ...uniqueResolvedAssets.map((asset) => {
      const sign = assetSignMap.get(asset.relativePath)!;
      const mimeType = resolveFileMimeType(asset.file);
      return {
        name: sign.fileName,
        uploadUrl: sign.uploadUrl,
        body: asset.file,
        mimeType,
      };
    }),
    {
      name: markdownSign.fileName,
      uploadUrl: markdownSign.uploadUrl,
      body: replacedBlob,
      mimeType: 'text/markdown',
    },
  ];

  const totalUploads = uploadTasks.length;
  let completedUploads = 0;

  onProgress?.({
    stage: 'uploading',
    current: 0,
    total: totalUploads,
    message: `ファイルをアップロード中 (0/${totalUploads})...`,
    percent: 30,
  });

  await Promise.all(
    uploadTasks.map(async (task) => {
      await uploadToR2(task.uploadUrl, task.body, task.mimeType);
      completedUploads++;
      const percent = 30 + Math.floor((completedUploads / totalUploads) * 45);
      onProgress?.({
        stage: 'uploading',
        current: completedUploads,
        total: totalUploads,
        message: `ファイルをアップロード中 (${completedUploads}/${totalUploads})...`,
        percent,
      });
    }),
  );

  onProgress?.({
    stage: 'committing',
    current: totalUploads,
    total: totalUploads,
    message: 'ドキュメントを更新中...',
    percent: 85,
  });

  /** 新規アップロードされた添付ファイルのコミット情報リスト。 */
  const newlyUploadedAttachments: DocumentAttachmentCommit[] =
    uniqueResolvedAssets.map((asset) => {
      const sign = assetSignMap.get(asset.relativePath)!;
      return {
        id: sign.fileId,
        fileName: sign.fileName,
        fileSize: asset.file.size,
        mimeType: resolveFileMimeType(asset.file),
        r2Key: sign.r2Key,
      };
    });

  /** 維持する既存添付ファイルのコミット情報リスト。 */
  const retainedExistingAttachments: DocumentAttachmentCommit[] =
    existingAttachments.map((att) => ({
      id: att.id,
      fileName: att.fileName,
      fileSize: att.fileSize,
      mimeType: att.mimeType,
      r2Key: att.r2Key,
    }));

  /** 既存と新規を統合した全添付ファイルのコミット配列。 */
  const finalAttachments: DocumentAttachmentCommit[] = [
    ...retainedExistingAttachments,
    ...newlyUploadedAttachments,
  ];

  /** ドキュメント本文から抽出した要約テキスト。 */
  const docDescription = extractDescription(replacedMarkdown, 160) || null;

  /** D1メタデータ更新コミットのレスポンス。 */
  const updateResponse = await updateDocument(
    documentId,
    {
      title: normalizedTitle.slice(0, 100),
      description: docDescription ?? undefined,
      contentR2Key: markdownSign.r2Key,
      attachments: finalAttachments,
    },
    token,
    baseUrl,
  );

  onProgress?.({
    stage: 'committing',
    current: totalUploads,
    total: totalUploads,
    message: 'ドキュメントの更新に成功。',
    percent: 100,
  });

  return updateResponse;
}
