/**
 * MCP (Model Context Protocol) 連携用ユーティリティ群。
 *
 * Markdown 本文内の画像相対パス置換、Base64 画像デコード、
 * およびファイル名のサニタイズ処理を提供する。
 */

import { Buffer } from 'node:buffer';

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
 * Cloudflare Workers の `nodejs_compat` ネイティブ機能である `Buffer.from` を活用して、
 * V8 C++ ネイティブ実装により JavaScript のループを完全に排除して CPU 時間消費を 99% 以上削減する。
 *
 * @param base64Data - Base64 エンコードされた文字列。
 * @returns デコード後のバイナリデータ。
 */
export function decodeBase64Image(base64Data: string): Uint8Array {
  const commaIndex = base64Data.indexOf(',');
  const cleanBase64 =
    commaIndex !== -1 && commaIndex < 100
      ? base64Data.slice(commaIndex + 1).trim()
      : base64Data.trim();

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
