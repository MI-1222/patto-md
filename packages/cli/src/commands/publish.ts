import fs from 'node:fs/promises';
import path from 'node:path';
import {
  MAX_PASSCODE_LENGTH,
  MAX_TOTAL_FILE_SIZE,
  MIN_PASSCODE_LENGTH,
  type DocumentAttachmentCommit,
  type DocumentCommitRequest,
  type DocumentVisibility,
  type ExpirationPreset,
  type UploadSignFileItem,
} from '@patto-md/shared';
import {
  commitDocument,
  requestUploadSign,
  resolveApiUrl,
  resolveFrontendUrl,
  uploadDirectToR2,
} from '../lib/api-client.ts';
import { requirePat } from '../lib/auth.ts';
import { copyToClipboard } from '../lib/clipboard.ts';
import {
  extractAndResolveAssets,
  extractTitle,
  replaceMarkdownImageUrls,
} from '../lib/markdown.ts';
import type { PublishCommandOptions } from '../types.ts';

/**
 * publish コマンドを実行する。
 *
 * ローカルのMarkdownファイルと相対参照された画像を解析し、Presigned PUT URL を経由して
 * 直接R2ストレージへアップロードした上で、本文内の画像パスを永続URLに置換してコミットし、
 * 発行された閲覧用パーマリンクを表示する。
 *
 * @param filePath - 対象Markdownファイルのパス。
 * @param options - 実行オプション。
 */
export async function runPublish(
  filePath: string,
  options: PublishCommandOptions = {},
): Promise<void> {
  let pat: string;
  try {
    pat = await requirePat(options.token);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }

  const absoluteMarkdownPath = path.resolve(filePath);
  let rawMarkdownContent: string;
  try {
    const stats = await fs.stat(absoluteMarkdownPath);
    if (!stats.isFile()) {
      console.error(`指定されたパスはファイルではありません: ${filePath}`);
      process.exitCode = 1;
      return;
    }
    rawMarkdownContent = await fs.readFile(absoluteMarkdownPath, 'utf-8');
  } catch (error) {
    console.error(
      `Markdownファイルの読み込みに失敗しました: ${(error as Error).message}`,
    );
    process.exitCode = 1;
    return;
  }

  const title =
    options.title && options.title.trim().length > 0
      ? options.title.trim()
      : extractTitle(rawMarkdownContent, absoluteMarkdownPath);

  const expiration: ExpirationPreset = options.expiration || '7days';

  const passcode = options.passcode?.trim();
  let visibility: DocumentVisibility;

  if (passcode && passcode.length > 0) {
    if (options.visibility && options.visibility !== 'protected') {
      console.error(
        `--passcode 指定時は公開範囲(--visibility)を 'protected' に設定する必要があります。(指定値: ${options.visibility})`,
      );
      process.exitCode = 1;
      return;
    }
    if (
      passcode.length < MIN_PASSCODE_LENGTH ||
      passcode.length > MAX_PASSCODE_LENGTH
    ) {
      console.error(
        `パスコードは${MIN_PASSCODE_LENGTH}文字以上${MAX_PASSCODE_LENGTH}文字以下で指定してください。`,
      );
      process.exitCode = 1;
      return;
    }
    visibility = 'protected';
  } else {
    visibility = options.visibility || 'unlisted';
    if (visibility === 'protected') {
      console.error(
        "公開範囲(--visibility)に 'protected' を指定する場合は、--passcode で暗証番号(4〜32文字)を指定する必要があります。",
      );
      process.exitCode = 1;
      return;
    }
  }

  console.log(`Markdown本文を解析中: ${path.basename(absoluteMarkdownPath)}`);
  const resolved = await extractAndResolveAssets(
    rawMarkdownContent,
    absoluteMarkdownPath,
  );

  if (resolved.invalidPaths.length > 0) {
    console.error('参照画像に不正なファイルが含まれています:');
    for (const item of resolved.invalidPaths) {
      console.error(`  - ${item.path}: ${item.reason}`);
    }
    process.exitCode = 1;
    return;
  }

  if (resolved.missingPaths.length > 0) {
    const allowMissing = options.allowMissing || options.allowIncomplete;
    if (allowMissing) {
      console.warn('警告: 以下の参照画像が存在しないためスキップします:');
      for (const missing of resolved.missingPaths) {
        console.warn(`  - ${missing}`);
      }
    } else {
      console.error(
        '以下の参照画像がローカルに見つかりません(--allow-missing オプションでリンク切れ公開を許可可能):',
      );
      for (const missing of resolved.missingPaths) {
        console.error(`  - ${missing}`);
      }
      process.exitCode = 1;
      return;
    }
  }

  const markdownByteLength = Buffer.byteLength(rawMarkdownContent, 'utf-8');
  const totalAssetsSize = resolved.assets.reduce(
    (sum, item) => sum + item.size,
    0,
  );
  const totalUploadSize = markdownByteLength + totalAssetsSize;

  if (totalUploadSize > MAX_TOTAL_FILE_SIZE) {
    console.error(
      `全体の合計ファイルサイズ制限(30MB)を超過しています: ${(totalUploadSize / 1024 / 1024).toFixed(2)}MB`,
    );
    process.exitCode = 1;
    return;
  }

  const apiUrl = await resolveApiUrl(options.apiUrl);
  const frontendUrl = await resolveFrontendUrl(options.frontendUrl, apiUrl);

  console.log(
    `アップロード準備中(画像 ${resolved.assets.length} 件, 合計 ${(totalUploadSize / 1024).toFixed(1)} KB)...`,
  );

  const markdownFileName = path.basename(absoluteMarkdownPath);
  const signFilesPayload: UploadSignFileItem[] = [
    {
      name: markdownFileName,
      size: markdownByteLength,
      type: 'text/markdown',
    },
    ...resolved.assets.map((asset) => ({
      name: asset.fileName,
      size: asset.size,
      type: asset.mimeType,
    })),
  ];

  let signResponse;
  try {
    signResponse = await requestUploadSign(
      signFilesPayload,
      expiration,
      pat,
      apiUrl,
    );
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }

  const markdownSignItem = signResponse.files[0];
  const imageSignItems = signResponse.files.slice(1);

  if (!markdownSignItem || imageSignItems.length !== resolved.assets.length) {
    console.error('署名レスポンスのファイル件数が一致しません。');
    process.exitCode = 1;
    return;
  }

  console.log('アセットをストレージへ直接アップロード中...');
  const pathMapping = new Map<string, string>();
  const attachments: DocumentAttachmentCommit[] = [];

  const uploadPromises = resolved.assets.map(async (asset, index) => {
    const signedItem = imageSignItems[index];
    if (!signedItem) {
      throw new Error(`署名情報の取得に失敗しました: ${asset.fileName}`);
    }

    await uploadDirectToR2(signedItem.uploadUrl, asset.buffer, asset.mimeType);

    const permanentAssetUrl = `/api/assets/${signedItem.r2Key}`;
    const targetPaths =
      asset.originalPaths && asset.originalPaths.length > 0
        ? asset.originalPaths
        : [asset.originalPath];
    for (const refPath of targetPaths) {
      pathMapping.set(refPath, permanentAssetUrl);
    }

    attachments.push({
      id: signedItem.fileId,
      fileName: asset.fileName,
      r2Key: signedItem.r2Key,
      fileSize: asset.size,
      mimeType: asset.mimeType,
    });
  });

  try {
    await Promise.all(uploadPromises);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }

  const replacedMarkdownContent = replaceMarkdownImageUrls(
    rawMarkdownContent,
    pathMapping,
  );
  const replacedBuffer = Buffer.from(replacedMarkdownContent, 'utf-8');

  try {
    await uploadDirectToR2(
      markdownSignItem.uploadUrl,
      replacedBuffer,
      'text/markdown',
    );
  } catch (error) {
    console.error(
      `Markdown本文のストレージ送信に失敗しました: ${(error as Error).message}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log('ドキュメントをコミット中...');
  const commitPayload: DocumentCommitRequest = {
    title,
    contentR2Key: markdownSignItem.r2Key,
    attachments,
    expiration,
    visibility,
    ...(visibility === 'protected' && passcode ? { passcode } : {}),
  };

  let commitResult;
  try {
    commitResult = await commitDocument(commitPayload, pat, apiUrl);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }

  const publicUrl = `${frontendUrl}/p/${commitResult.id}`;

  let copied = false;
  if (options.copy !== false) {
    copied = await copyToClipboard(publicUrl);
  }

  console.log('\n--- 公開完了 ---');
  console.log(`タイトル: ${title}`);
  console.log(`URL: ${publicUrl}`);
  console.log(`有効期限: ${expiration}`);
  console.log(`公開範囲: ${visibility}`);
  if (options.copy !== false) {
    console.log(
      copied
        ? 'クリップボードにURLをコピーしました。'
        : 'クリップボードへの自動コピーはスキップされました。',
    );
  }
}
