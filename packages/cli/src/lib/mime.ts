import type { AllowedImageMimeType } from '@patto-md/shared';

/**
 * ファイルパスの拡張子に基づき、許可された画像MIMEタイプを解決する。
 *
 * @param filePath - 解決対象のファイル名またはパス。
 * @returns 許可された画像MIMEタイプ文字列。対象外拡張子の場合は `null`。
 */
export function resolveImageMimeType(
  filePath: string,
): AllowedImageMimeType | null {
  const ext = (filePath.split('.').pop() || '').toLowerCase();

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
    default:
      return null;
  }
}
