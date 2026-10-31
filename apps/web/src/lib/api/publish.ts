import {
  MAX_TOTAL_FILE_SIZE,
  type DocumentAttachmentCommit,
  type DocumentCommitResponse,
  type DocumentVisibility,
  type ExpirationPreset,
  type UploadSignFileItem,
  type UploadSignFileResponseItem,
} from '@patto-md/shared';
import { requestUploadSign, uploadToR2, commitDocument } from './client';
import {
  getBasename,
  replaceMarkdownImageUrls,
  extractDescription,
  type MarkdownParseResult,
  type ReconciliationResult,
  type ResolvedAsset,
} from '../markdown';
import {
  compressImagesConcurrently,
  type CompressedImageResult,
} from '../storage';
import type { ParsedFiles } from '../../components/dropzone/types';

/** パイプライン進行進捗情報の定義。 */
export interface PublishProgressInfo {
  /** 進行ステージ。 */
  stage: 'optimizing' | 'signing' | 'uploading' | 'committing';
  /** 完了件数。 */
  current: number;
  /** 全体件数。 */
  total: number;
  /** ユーザー向けの進捗メッセージ。 */
  message: string;
  /** 進捗割合 (0〜100)。 */
  percent: number;
}

/** ドキュメント公開実行パラメータの定義。 */
export interface ExecutePublishPipelineParams {
  /** ドロップおよび分類済みのファイル群。 */
  parsedFiles: ParsedFiles;
  /** 仮想ファイルマップの突合結果。 */
  reconciliation: ReconciliationResult | null;
  /** Markdown解析結果。 */
  parseResult: MarkdownParseResult | null;
  /** 原本となるMarkdownテキスト文字列。 */
  markdownContent: string;
  /** 選択された有効期限プリセット。 */
  expiration: ExpirationPreset;
  /** ドキュメント公開範囲。 */
  visibility?: DocumentVisibility;
  /** パスコード保護時の平文パスコード。 */
  passcode?: string;
  /** 未解決画像のリンク切れ公開を容認するかどうかの真偽値。 */
  allowIncompletePublish?: boolean;
  /** Cloudflare Turnstile ボット検証トークン。 */
  turnstileToken?: string;
  /** 接続先APIベースURL。 */
  baseUrl?: string;
  /** 進捗コールバックハンドラー。 */
  onProgress?: (progress: PublishProgressInfo) => void;
}

/**
 * ファイルのMIMEタイプを安全に取得する。
 * ブラウザやOS環境により `file.type` が空文字列となる場合、ファイル拡張子から判定および補完する。
 *
 * @param file - 判定対象ファイル。
 * @param defaultFallback - 判定不能時の既定MIMEタイプ。
 * @returns 解決されたMIMEタイプ文字列。
 */
export function resolveFileMimeType(
  file: File,
  defaultFallback: UploadSignFileItem['type'] = 'image/png',
): UploadSignFileItem['type'] {
  if (file.type && file.type.trim().length > 0) {
    return file.type as UploadSignFileItem['type'];
  }

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    case 'md':
    case 'markdown':
      return 'text/markdown';
    default:
      return defaultFallback;
  }
}

/**
 * Direct Uploadおよびドキュメント確定コミットの全体パイプラインを実行する。
 *
 * 次の一連の処理を実行する。
 * 1. 解決済み画像群およびMarkdown本文の一括署名取得 (`POST /api/upload/sign`)。
 * 2. Markdown本文中の画像URLを永続パス (`/api/assets/${r2Key}`) へ一括置換。
 * 3. R2ストレージへの並列直接アップロード (ブラウザ Direct PUT)。
 * 4. メタデータの確定コミットおよびパーマリンク発行 (`POST /api/documents`)。
 *
 * @param params - 公開実行パラメータ。
 * @returns 確定コミットレスポンス。
 */
export async function executePublishPipeline(
  params: ExecutePublishPipelineParams,
): Promise<DocumentCommitResponse> {
  const {
    parsedFiles,
    reconciliation,
    parseResult,
    markdownContent,
    expiration,
    visibility = 'public',
    passcode,
    allowIncompletePublish = false,
    turnstileToken,
    baseUrl,
    onProgress,
  } = params;

  const { markdownFile, hasInvalidFiles } = parsedFiles;

  if (!markdownFile) {
    throw new Error('Markdownファイルが指定されていません。');
  }

  if (hasInvalidFiles) {
    throw new Error('制約違反のファイルが含まれています。');
  }

  if (!reconciliation) {
    throw new Error('ファイル突合が完了していません。');
  }

  if (!reconciliation.isComplete && !allowIncompletePublish) {
    throw new Error('未解決の画像が存在します。');
  }

  const uniqueResolvedAssets: ResolvedAsset[] = [];
  const seenRelativePaths = new Set<string>();

  for (const asset of reconciliation.resolved.values()) {
    if (!seenRelativePaths.has(asset.relativePath)) {
      seenRelativePaths.add(asset.relativePath);
      uniqueResolvedAssets.push(asset);
    }
  }

  const totalAssets = uniqueResolvedAssets.length;
  /** 解決済み画像アセットの圧縮・最適化結果マップ。 */
  const compressedAssetMap = new Map<string, CompressedImageResult>();

  if (totalAssets > 0) {
    onProgress?.({
      stage: 'optimizing',
      current: 0,
      total: totalAssets,
      message: `画像を最適化中 (0/${totalAssets})...`,
      percent: 5,
    });

    const compressionResults = await compressImagesConcurrently(
      uniqueResolvedAssets.map((asset) => asset.file),
      {
        concurrency: 2,
        onProgress: (current, total) => {
          const percent = 5 + Math.floor((current / total) * 15);
          onProgress?.({
            stage: 'optimizing',
            current,
            total,
            message: `画像を最適化中 (${current}/${total})...`,
            percent,
          });
        },
      },
    );

    for (let i = 0; i < totalAssets; i++) {
      compressedAssetMap.set(
        uniqueResolvedAssets[i].relativePath,
        compressionResults[i],
      );
    }
  }

  /** 最適化後画像アセットとMarkdown本文の最終合計サイズ(バイト)。 */
  const finalTotalUploadSize =
    markdownFile.file.size +
    uniqueResolvedAssets.reduce((sum, asset) => {
      const comp = compressedAssetMap.get(asset.relativePath);
      return sum + (comp ? comp.size : asset.file.size);
    }, 0);

  if (finalTotalUploadSize > MAX_TOTAL_FILE_SIZE) {
    throw new Error(
      'アップロードファイルの合計サイズが上限(30MB)を超過しています。',
    );
  }

  onProgress?.({
    stage: 'signing',
    current: 0,
    total: uniqueResolvedAssets.length + 1,
    message: '署名を発行中...',
    percent: 25,
  });

  const fileSignItems: UploadSignFileItem[] = [
    ...uniqueResolvedAssets.map((asset) => {
      const compressed = compressedAssetMap.get(asset.relativePath);
      const fallbackName =
        getBasename(asset.relativePath) || asset.file.name || 'image';
      const fileName = compressed ? compressed.fileName : fallbackName;
      const fileSize = compressed ? compressed.size : asset.file.size;
      const mimeType = (
        compressed?.wasCompressed
          ? compressed.mimeType
          : resolveFileMimeType(asset.file)
      ) as UploadSignFileItem['type'];

      return {
        name: fileName,
        size: fileSize,
        type: mimeType,
      };
    }),
    {
      name: markdownFile.file.name || 'content.md',
      size: markdownFile.file.size,
      type: resolveFileMimeType(markdownFile.file, 'text/markdown'),
    },
  ];

  const signResponse = await requestUploadSign(
    fileSignItems,
    baseUrl,
    turnstileToken,
    expiration,
  );
  const signedFiles = signResponse.files;

  const markdownSign = signedFiles[signedFiles.length - 1];
  const assetSignMap = new Map<string, UploadSignFileResponseItem>();
  uniqueResolvedAssets.forEach((asset, index) => {
    assetSignMap.set(asset.relativePath, signedFiles[index]);
  });

  const urlMap = new Map<string, string>();
  for (const [cleanPath, resolvedAsset] of reconciliation.resolved.entries()) {
    const sign = assetSignMap.get(resolvedAsset.relativePath);
    if (sign) {
      urlMap.set(cleanPath, `/api/assets/${sign.r2Key}`);
    }
  }

  const imageRefs = parseResult?.imageRefs || [];
  const replacedMarkdown = replaceMarkdownImageUrls(
    markdownContent,
    imageRefs,
    urlMap,
  );

  const replacedBlob = new Blob([replacedMarkdown], {
    type: 'text/markdown; charset=utf-8',
  });

  const uploadTasks: {
    name: string;
    uploadUrl: string;
    body: Blob | File;
    mimeType: string;
  }[] = [
    ...uniqueResolvedAssets.map((asset) => {
      const sign = assetSignMap.get(asset.relativePath)!;
      const compressed = compressedAssetMap.get(asset.relativePath);
      const body = compressed ? compressed.blob : asset.file;
      const mimeType = compressed?.wasCompressed
        ? compressed.mimeType
        : resolveFileMimeType(asset.file);
      return {
        name: sign.fileName,
        uploadUrl: sign.uploadUrl,
        body,
        mimeType,
      };
    }),
    {
      name: markdownSign.fileName,
      uploadUrl: markdownSign.uploadUrl,
      body: replacedBlob,
      mimeType: resolveFileMimeType(markdownFile.file, 'text/markdown'),
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
    message: 'ドキュメントを保存中...',
    percent: 85,
  });

  const docTitle =
    parseResult?.title ||
    markdownFile.file.name.replace(/\.[^/.]+$/, '').trim() ||
    'Untitled';

  const finalTitle = docTitle.slice(0, 100);
  const docDescription = extractDescription(markdownContent, 160) || null;

  const attachmentsPayload: DocumentAttachmentCommit[] =
    uniqueResolvedAssets.map((asset) => {
      const sign = assetSignMap.get(asset.relativePath)!;
      const compressed = compressedAssetMap.get(asset.relativePath);
      const fileSize = compressed ? compressed.size : asset.file.size;
      const mimeType = compressed?.wasCompressed
        ? compressed.mimeType
        : resolveFileMimeType(asset.file);
      return {
        id: sign.fileId,
        fileName: sign.fileName,
        fileSize,
        mimeType,
        r2Key: sign.r2Key,
      };
    });

  const commitResponse = await commitDocument(
    {
      title: finalTitle,
      description: docDescription ?? undefined,
      contentR2Key: markdownSign.r2Key,
      attachments: attachmentsPayload,
      expiration,
      visibility,
      passcode: visibility === 'protected' ? passcode : undefined,
    },
    baseUrl,
  );

  onProgress?.({
    stage: 'committing',
    current: totalUploads,
    total: totalUploads,
    message: 'ドキュメントの公開に成功。',
    percent: 100,
  });

  return commitResponse;
}
