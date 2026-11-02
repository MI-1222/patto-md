/**
 * MIMEタイプ判定および解決ユーティリティ。
 *
 * ホワイトリストに基づく安全な画像・テキストMIMEタイプの解決、
 * 拡張子マッピング、および Data URL からの抽出処理を提供する。
 */

import {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_MIME_TYPES,
  type AllowedImageMimeType,
  type AllowedMimeType,
} from '../constants/limits.ts';

/** 拡張子と画像MIMEタイプの対応マッピングテーブル。 */
export const EXTENSION_IMAGE_MIME_MAP: Record<string, AllowedImageMimeType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

/** 拡張子とテキストMIMEタイプの対応マッピングテーブル。 */
export const EXTENSION_TEXT_MIME_MAP: Record<string, 'text/markdown'> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
};

/**
 * 指定された値が許可された画像MIMEタイプであるかを判定する型ガード。
 *
 * @param mime - 判定対象の値。
 * @returns 許可された画像MIMEタイプであれば true。
 */
export function isAllowedImageMimeType(
  mime: unknown,
): mime is AllowedImageMimeType {
  return (
    typeof mime === 'string' &&
    (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mime)
  );
}

/**
 * 指定された値がアップロード許可されたMIMEタイプであるかを判定する型ガード。
 *
 * @param mime - 判定対象の値。
 * @returns 許可されたMIMEタイプであれば true。
 */
export function isAllowedMimeType(mime: unknown): mime is AllowedMimeType {
  return (
    typeof mime === 'string' &&
    (ALLOWED_MIME_TYPES as readonly string[]).includes(mime)
  );
}

/**
 * ファイル名またはパスの拡張子に基づき、許可された画像MIMEタイプを解決する。
 *
 * @param filePathOrName - 解決対象のファイル名またはパス。
 * @returns 許可された画像MIMEタイプ文字列。対象外または不明な拡張子の場合は null。
 */
export function resolveImageMimeType(
  filePathOrName: string,
): AllowedImageMimeType | null {
  if (!filePathOrName || typeof filePathOrName !== 'string') {
    return null;
  }

  const ext = (filePathOrName.split('.').pop() || '').toLowerCase();
  return EXTENSION_IMAGE_MIME_MAP[ext] ?? null;
}

/**
 * Data URL 文字列から画像MIMEタイプを抽出し、ホワイトリストで検証して返却する。
 *
 * 例: `data:image/png;base64,...` から `image/png` を抽出する。
 *
 * @param dataUrl - Data URL 文字列。
 * @returns 許可された画像MIMEタイプ。抽出不能または許可対象外の場合は null。
 */
export function extractMimeFromDataUrl(
  dataUrl: string,
): AllowedImageMimeType | null {
  if (!dataUrl || typeof dataUrl !== 'string') {
    return null;
  }

  const match = /^data:(image\/[a-zA-Z0-9+.-]+);base64,/i.exec(dataUrl);
  if (!match) {
    return null;
  }

  const mime = match[1].toLowerCase();
  return isAllowedImageMimeType(mime) ? mime : null;
}

/**
 * ファイルオブジェクトまたはファイル名からMIMEタイプを安全に解決する。
 *
 * 明示的な `file.type` が存在する場合はそれを優先し、空文字または未指定の場合は拡張子から解決する。
 * 画像(PNG, JPEG, WebP, GIF, SVG)および Markdown(MD)を自動判定し、解決不能時はフォールバック値を返却する。
 *
 * @param target - ファイル情報オブジェクトまたはファイル名/パス文字列。
 * @param defaultFallback - 判定不能時のフォールバックMIMEタイプ(既定値: 'image/png')。
 * @returns 解決されたMIMEタイプ文字列。
 */
export function resolveFileMimeType(
  target: string | { name: string; type?: string | null },
  defaultFallback = 'image/png',
): string {
  if (!target) {
    return defaultFallback;
  }

  const name = typeof target === 'string' ? target : target.name;
  const explicitType =
    typeof target === 'object' && target !== null ? target.type : null;

  if (explicitType && explicitType.trim().length > 0) {
    return explicitType;
  }

  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext in EXTENSION_IMAGE_MIME_MAP) {
    return EXTENSION_IMAGE_MIME_MAP[ext];
  }
  if (ext in EXTENSION_TEXT_MIME_MAP) {
    return EXTENSION_TEXT_MIME_MAP[ext];
  }

  return defaultFallback;
}
