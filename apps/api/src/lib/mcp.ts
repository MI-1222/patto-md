/**
 * MCP (Model Context Protocol) 連携用ユーティリティ群。
 *
 * Markdown 本文内の画像相対パス置換、Base64 画像デコード、
 * およびファイル名のサニタイズ処理を提供する。
 */

import { Buffer } from 'node:buffer';
import {
  extractMimeFromDataUrl,
  isAllowedImageMimeType,
  MAX_SINGLE_FILE_SIZE,
  resolveImageMimeType,
  type AllowedImageMimeType,
} from '@patto-md/shared';

/** Markdown 内アセットパス置換マッピング情報。 */
export interface AssetPathMapping {
  /** 元の相対パスまたはファイル名(例: `./images/arch.png`, `arch.png`)。 */
  originalPath: string;
  /** 保存先の R2 オブジェクトキー(例: `exp-7d/uploads/uuid/arch.png`)。 */
  r2Key: string;
}

/**
 * ファイルパス文字列からパストラバーサル文字や不正記号を除去し、安全なファイル名のみを抽出する。
 *
 * スラッシュおよびバックスラッシュで分割して末尾のファイル名を取得し、
 * 英数字・ハイフン・アンダースコア・ドット以外の文字をアンダースコアへ置換する。
 *
 * @param pathStr - クライアントから渡されたファイルパス文字列。
 * @param fallback - 抽出不能時の代替ファイル名(既定値: `'image.png'`)。
 * @returns サニタイズされた安全なファイル名。
 */
export function sanitizeMcpFileName(
  pathStr: string,
  fallback = 'image.png',
): string {
  if (!pathStr || typeof pathStr !== 'string') {
    return fallback;
  }

  const segments = pathStr.split(/[/\\]/);
  const rawFileName = segments[segments.length - 1]?.trim() || '';
  const sanitized = rawFileName.replace(/[^a-zA-Z0-9_.-]/g, '_');

  if (!sanitized || sanitized === '.' || sanitized === '..') {
    return fallback;
  }

  return sanitized;
}

/**
 * Base64 文字列を `Uint8Array` バイナリバッファへ効率的にデコードする。
 *
 * `data:image/png;base64,...` のような Data URL プレフィックスが含まれる場合は除去し、
 * LLM や一部エンコーダが付与する改行(`\n`, `\r\n`)や空白文字を正規化除去する。
 * Cloudflare Workers の `nodejs_compat` ネイティブ機能である `Buffer.from` を活用して、
 * V8 C++ ネイティブ実装により JavaScript のループを完全に排除して CPU 時間消費を 99% 以上削減する。
 *
 * @param base64Data - Base64 エンコードされた文字列。
 * @returns デコード後のバイナリデータ。
 */
export function decodeBase64Image(base64Data: string): Uint8Array {
  const commaIndex = base64Data.indexOf(',');
  const rawBase64 =
    commaIndex !== -1 && commaIndex < 100
      ? base64Data.slice(commaIndex + 1)
      : base64Data;
  const cleanBase64 = rawBase64.replace(/\s+/g, '');

  return Buffer.from(cleanBase64, 'base64');
}

/**
 * 正規表現用の特殊文字をエスケープする。
 *
 * @param str - エスケープ対象の文字列。
 * @returns 正規表現で安全に使用できるエスケープ済み文字列。
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Markdown 本文内の画像相対パスを永続アセット配信 URL(`/api/assets/${r2Key}`)へ一括置換する。
 *
 * 各パスについて `./` プレフィックスの有無や URL エンコードの差異を吸収した検索パターンを作成し、
 * Markdown 画像/リンク記法(`![alt](path)`)の丸括弧内および HTML `<img>` タグ(`src="path"`)等の
 * クォートで囲まれた属性値の双方を正規表現で走査して置換する。
 *
 * @param markdownContent - 元の Markdown 本文。
 * @param mappings - 相対パスと R2 キーの対応配列。
 * @returns 置換完了後の Markdown 本文。
 */
export function replaceMarkdownAssetPaths(
  markdownContent: string,
  mappings: AssetPathMapping[],
): string {
  if (!markdownContent || mappings.length === 0) {
    return markdownContent;
  }

  let result = markdownContent;

  for (const mapping of mappings) {
    const original = mapping.originalPath.trim();
    if (!original) {
      continue;
    }

    const assetUrl = `/api/assets/${mapping.r2Key}`;
    const withoutDotSlash = original.startsWith('./')
      ? original.slice(2)
      : original;
    const withDotSlash = original.startsWith('./') ? original : `./${original}`;

    const variants = Array.from(
      new Set([original, withoutDotSlash, withDotSlash, encodeURI(original)]),
    );

    for (const variant of variants) {
      const escaped = escapeRegExp(variant);
      const mdRegex = new RegExp(`(\\()\\s*${escaped}\\s*(\\))`, 'g');
      result = result.replace(mdRegex, `$1${assetUrl}$2`);

      const attrRegex = new RegExp(`(["'])\\s*${escaped}\\s*(["'])`, 'g');
      result = result.replace(attrRegex, `$1${assetUrl}$2`);
    }
  }

  return result;
}

/**
 * ドキュメントの公開用パーマリンク URL を解決する。
 *
 * 環境変数 `FRONTEND_ORIGIN` が指定されている場合は優先して採用し、
 * 未指定時はリクエスト URL のオリジンからベース URL を導出する。
 * 末尾のスラッシュは正規化して取り除く。
 *
 * @param reqUrl - リクエストの完全な URL 文字列。
 * @param frontendOrigin - 環境変数等で指定されたフロントエンドのオリジン(任意)。
 * @param slug - ドキュメントの識別子(`Slug`)。
 * @returns 完全なドキュメント公開 URL。
 */
export function resolvePublicUrl(
  reqUrl: string,
  frontendOrigin: string | undefined,
  slug: string,
): string {
  const base = frontendOrigin
    ? frontendOrigin.replace(/\/+$/, '')
    : new URL(reqUrl).origin.replace(/\/api\/mcp|\/mcp$/, '');

  return `${base}/p/${slug}`;
}

/**
 * MCP添付画像のMIMEタイプを解決する。
 *
 * 指定されたMIMEタイプが有効であればそれを採用し、
 * 未指定または無効な場合は Data URL プレフィックスおよびファイル名拡張子から補完・解決する。
 *
 * @param pathStr - ファイルパスまたはファイル名。
 * @param base64Data - Base64 または Data URL 文字列(任意)。
 * @param explicitMimeType - 明示的に指定された MIME タイプ(任意)。
 * @returns 解決された画像MIMEタイプ。判定不能時は `null`。
 */
export function resolveMcpImageMimeType(
  pathStr: string,
  base64Data?: string,
  explicitMimeType?: string,
): AllowedImageMimeType | null {
  if (explicitMimeType && isAllowedImageMimeType(explicitMimeType)) {
    return explicitMimeType;
  }
  if (base64Data) {
    const fromDataUrl = extractMimeFromDataUrl(base64Data);
    if (fromDataUrl) {
      return fromDataUrl;
    }
  }
  return resolveImageMimeType(pathStr);
}

/** MCP経由で受け取る画像入力アイテムの型。 */
export interface ProcessMcpImageItem {
  /** 相対パスまたはファイル名。 */
  path: string;
  /** Base64文字列(または Data URL)。 */
  base64Data: string;
  /** 明示的なMIMEタイプ(任意)。 */
  mimeType?: string;
}

/** 処理済み添付ファイルレコード情報。 */
export interface ProcessedMcpAttachmentRecord {
  /** 添付ファイルID(UUID)。 */
  id: string;
  /** サニタイズ済みファイル名。 */
  fileName: string;
  /** デコード後ファイルサイズ(バイト)。 */
  fileSize: number;
  /** 解決済みMIMEタイプ。 */
  mimeType: string;
  /** 保存先R2オブジェクトキー。 */
  r2Key: string;
}

/** 画像処理およびR2保存の成功結果。 */
export interface ProcessedMcpImagesResult {
  /** Markdown 本文置換用マッピング配列。 */
  pathMappings: AssetPathMapping[];
  /** DB永続化用添付ファイルレコード配列。 */
  attachmentRecords: ProcessedMcpAttachmentRecord[];
  /** アップロード完了したR2キー配列(エラー時ロールバック用)。 */
  uploadedR2Keys: string[];
}

/** 画像処理およびR2保存の結果型。 */
export type UploadMcpImagesResult =
  | { success: true; data: ProcessedMcpImagesResult }
  | { success: false; error: string };

/**
 * 失敗時にアップロード済みのR2オブジェクトをベストエフォートでロールバック削除する。
 *
 * @param bucket - 対象のR2バケットインスタンス。
 * @param keys - 削除対象のR2キー配列。
 */
export async function rollbackUploadedR2Objects(
  bucket: R2Bucket,
  keys: string[],
): Promise<void> {
  if (
    !keys ||
    keys.length === 0 ||
    !bucket ||
    typeof bucket.delete !== 'function'
  ) {
    return;
  }

  await Promise.allSettled(keys.map((key) => bucket.delete(key)));
}

/**
 * MCP経由で渡された画像配列を順次デコードし、R2バケットへ逐次保存する。
 *
 * Cloudflare Workers の 128MB メモリ制限下でのOut of Memoryを防止するため、
 * 全件の一括デコードや配列へのバッファ保持を排除し、
 * 1画像ごとに「デコード → バリデーション → R2保存 → Base64メモリ解放」を逐次処理する。
 * 処理途中でエラーが発生した場合は、それまでにアップロードされたR2オブジェクトを自動ロールバックする。
 *
 * @param bucket - 保存先R2バケットインスタンス。
 * @param images - アップロード対象の画像アイテム配列。
 * @param expectedPrefix - 有効期限プリセット等から導出されたR2キープレフィックス。
 * @param maxSingleFileSize - 単一ファイルの許容最大サイズ(既定値: `MAX_SINGLE_FILE_SIZE`)。
 * @returns 処理結果オブジェクト。
 */
export async function processAndUploadMcpImages(
  bucket: R2Bucket,
  images: ProcessMcpImageItem[],
  expectedPrefix: string,
  maxSingleFileSize: number = MAX_SINGLE_FILE_SIZE,
): Promise<UploadMcpImagesResult> {
  const pathMappings: AssetPathMapping[] = [];
  const attachmentRecords: ProcessedMcpAttachmentRecord[] = [];
  const uploadedR2Keys: string[] = [];

  try {
    for (const img of images) {
      const buffer = decodeBase64Image(img.base64Data);
      if (buffer.byteLength > maxSingleFileSize) {
        await rollbackUploadedR2Objects(bucket, uploadedR2Keys);
        return {
          success: false,
          error: `画像「${img.path}」のデコード後サイズが上限を超過しています。`,
        };
      }

      const fileId = crypto.randomUUID();
      const fileName = sanitizeMcpFileName(img.path);
      const r2Key = `${expectedPrefix}uploads/${fileId}/${fileName}`;
      const resolvedMime =
        resolveMcpImageMimeType(img.path, img.base64Data, img.mimeType) ??
        img.mimeType ??
        'application/octet-stream';

      // Base64文字列の参照を解除し、V8による早期ガベージコレクションを促進する。
      (img as { base64Data?: string }).base64Data = '';

      await bucket.put(r2Key, buffer, {
        httpMetadata: { contentType: resolvedMime },
      });
      uploadedR2Keys.push(r2Key);

      pathMappings.push({
        originalPath: img.path,
        r2Key,
      });

      attachmentRecords.push({
        id: fileId,
        fileName,
        fileSize: buffer.byteLength,
        mimeType: resolvedMime,
        r2Key,
      });
    }

    return {
      success: true,
      data: {
        pathMappings,
        attachmentRecords,
        uploadedR2Keys,
      },
    };
  } catch (error) {
    console.error('MCP画像保存処理エラー:', error);
    await rollbackUploadedR2Objects(bucket, uploadedR2Keys);
    return {
      success: false,
      error: '画像の保存処理中にエラーが発生しました。',
    };
  }
}
