/**
 * OGPおよびTwitter Cards用のメタデータ抽出・解決ユーティリティ。
 *
 * エッジSSRの制限時間内で動作するよう、フルAST解析を避けて軽量な正規表現により
 * 先頭画像および本文抜粋テキストの抽出を行う。
 * また、パスコード保護時や限定公開時における検索除外・機密情報マスキングを確実に実施する。
 */
import { extractDescription } from '../markdown/renderer';
import type {
  OgpAttachmentItem,
  OgpDocumentSource,
  OgpMetadata,
  ResolveOgpOptions,
} from './types';

/** デフォルトのサービス共通OGP画像パス。 */
export const DEFAULT_OGP_IMAGE_PATH = '/ogp.jpeg';

/** パスコード保護ドキュメント用の固定タイトル。 */
export const MASKED_OGP_TITLE = 'パスコード保護されたドキュメント - patto-md';

/** パスコード保護ドキュメント用の固定説明文。 */
export const MASKED_OGP_DESCRIPTION =
  'このドキュメントを閲覧するにはパスコードが必要です。';

/** 本文抜粋および説明文の最大文字数。 */
export const MAX_DESCRIPTION_LENGTH = 120;

/** デフォルトのドキュメント説明文フォールバック。 */
export const DEFAULT_DOCUMENT_DESCRIPTION =
  'patto-mdで共有されたMarkdownドキュメント。';

/** SVGフォーマットを判定する正規表現。 */
const SVG_PATTERN = /\.svg(?:[?#]|$)/i;

/** Data URI または Blob URL を判定する正規表現。 */
const UNSUPPORTED_IMAGE_PROTOCOL_PATTERN = /^(?:data:|blob:)/i;

/** Markdown画像構文 (`![alt](url "title")`) の走査用正規表現。 */
const MARKDOWN_IMAGE_PATTERN =
  /!\[(?:[^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;

/** HTML `<img>` タグ (`<img ... src="..." ...>`) の走査用正規表現。 */
const HTML_IMAGE_PATTERN = /<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*?>/gi;

/**
 * 指定されたURLまたはパスがOGP画像として利用可能か判定する。
 * SVG、Data URI、Blob URLは各種SNSクローラーで非対応のため除外する。
 *
 * @param url - 検証対象の画像URLまたはパス。
 * @returns 利用可能であれば `true`。
 */
export function isSupportedOgpImageUrl(
  url: string | null | undefined,
): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (UNSUPPORTED_IMAGE_PROTOCOL_PATTERN.test(trimmed)) {
    return false;
  }
  if (SVG_PATTERN.test(trimmed)) {
    return false;
  }
  return true;
}

/**
 * 添付ファイルがOGP画像として利用可能か判定する。
 *
 * @param attachment - 検証対象の添付ファイル。
 * @returns ラスター画像であれば `true`。
 */
export function isSupportedAttachmentImage(
  attachment: OgpAttachmentItem,
): boolean {
  if (!attachment || !attachment.r2Key) {
    return false;
  }
  if (attachment.mimeType) {
    const mime = attachment.mimeType.toLowerCase();
    if (mime.includes('svg')) {
      return false;
    }
    if (mime.startsWith('image/')) {
      return true;
    }
  }
  if (attachment.fileName && SVG_PATTERN.test(attachment.fileName)) {
    return false;
  }
  return true;
}

/**
 * ドキュメント本文および添付ファイル一覧から、OGPに利用可能な先頭画像のURLを抽出する。
 *
 * 探索優先順位:
 * 1. Markdown本文中の先頭画像構文 (`![alt](url)`)
 * 2. Markdown本文中の先頭HTML `<img>` タグ (`<img src="url">`)
 * 3. 添付ファイル一覧 (`attachments`) の先頭ラスター画像
 *
 * @param content - Markdown本文文字列。
 * @param attachments - 添付ファイル一覧。
 * @returns 抽出された画像URLまたは内部パス。見つからない場合は `null`。
 */
export function extractFirstImageUrl(
  content?: string | null,
  attachments?: OgpAttachmentItem[],
): string | null {
  if (content && typeof content === 'string') {
    const mdMatches = content.matchAll(MARKDOWN_IMAGE_PATTERN);
    for (const match of mdMatches) {
      const rawUrl = match[1]?.trim();
      if (isSupportedOgpImageUrl(rawUrl)) {
        return rawUrl;
      }
    }

    const htmlMatches = content.matchAll(HTML_IMAGE_PATTERN);
    for (const match of htmlMatches) {
      const rawUrl = match[1]?.trim();
      if (isSupportedOgpImageUrl(rawUrl)) {
        return rawUrl;
      }
    }
  }

  if (attachments && Array.isArray(attachments)) {
    for (const attachment of attachments) {
      if (isSupportedAttachmentImage(attachment)) {
        return `/api/assets/${attachment.r2Key}`;
      }
    }
  }

  return null;
}

/**
 * 与えられた文字列から改行や余剰空白を除去し、指定長へ切り詰めた説明文を返却する。
 *
 * @param rawText - 元の説明文テキスト。
 * @param fallbackContent - `rawText` 未指定時に抽出を試みるMarkdown本文。
 * @param maxLength - 最大文字数。デフォルトは 120 文字。
 * @returns 整形済み説明文テキスト。
 */
export function cleanDescription(
  rawText?: string | null,
  fallbackContent?: string | null,
  maxLength: number = MAX_DESCRIPTION_LENGTH,
): string {
  if (rawText && typeof rawText === 'string') {
    const flattened = rawText.replace(/\s+/g, ' ').trim();
    if (flattened.length > 0) {
      if (flattened.length <= maxLength) {
        return flattened;
      }
      return `${flattened.slice(0, maxLength)}...`;
    }
  }

  if (fallbackContent && typeof fallbackContent === 'string') {
    const extracted = extractDescription(fallbackContent, maxLength);
    if (extracted && extracted.trim().length > 0) {
      return extracted.replace(/\s+/g, ' ').trim();
    }
  }

  return DEFAULT_DOCUMENT_DESCRIPTION;
}

/**
 * 相対パスまたはURLを完全修飾絶対URLへ変換する。
 *
 * @param pathOrUrl - 変換対象のパスまたはURL。
 * @param baseUrl - 基準となるベースURL。
 * @returns 完全修飾絶対URL文字列。
 */
export function toAbsoluteUrl(
  pathOrUrl: string,
  baseUrl: URL | string,
): string {
  const trimmed = pathOrUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return new URL(trimmed, baseUrl).href;
}

/**
 * 画像URLに更新日時タイムスタンプのキャッシュバスターを付与する。
 *
 * @param imageUrl - 元の画像URL。
 * @param updatedAt - 最終更新日時 (ISO 8601形式)。
 * @returns キャッシュバスター付き画像URL。
 */
export function appendCacheBuster(
  imageUrl: string,
  updatedAt?: string,
): string {
  if (!updatedAt) {
    return imageUrl;
  }
  const timestamp = new Date(updatedAt).getTime();
  if (Number.isNaN(timestamp) || timestamp <= 0) {
    return imageUrl;
  }

  const separator = imageUrl.includes('?') ? '&' : '?';
  return `${imageUrl}${separator}v=${timestamp}`;
}

/**
 * ドキュメント情報および環境オプションから、完全なOGPメタデータオブジェクトを算出・解決する。
 *
 * @param doc - ドキュメント情報。
 * @param options - 解決オプション。
 * @returns OGPおよびTwitter Cards用メタデータ。
 */
export function resolveDocumentOgp(
  doc: OgpDocumentSource,
  options: ResolveOgpOptions,
): OgpMetadata {
  const currentUrl =
    typeof options.currentUrl === 'string'
      ? new URL(options.currentUrl)
      : options.currentUrl;

  const origin = currentUrl.origin;
  const defaultImagePath = options.defaultImagePath || DEFAULT_OGP_IMAGE_PATH;
  const defaultAbsoluteImageUrl = toAbsoluteUrl(defaultImagePath, origin);

  /** クエリパラメータやハッシュフラグメントを除去して正規化したカノニカルURL。 */
  const canonicalUrl = toAbsoluteUrl(`/p/${doc.id}`, origin);

  if (doc.isProtected || doc.visibility === 'protected') {
    return {
      title: MASKED_OGP_TITLE,
      description: MASKED_OGP_DESCRIPTION,
      imageUrl: defaultAbsoluteImageUrl,
      cardType: 'summary',
      noindex: true,
      canonicalUrl,
      ogType: 'article',
    };
  }

  /** フォーマット済みのページタイトル。 */
  const formattedTitle = `${doc.title} - patto-md`;

  /** 抽出および整形済みの説明文テキスト。 */
  const description = cleanDescription(
    doc.description,
    doc.content,
    MAX_DESCRIPTION_LENGTH,
  );

  /** 本文または添付ファイルから検出された先頭画像パス。 */
  const firstImage = extractFirstImageUrl(doc.content, doc.attachments);

  let imageUrl: string;
  let cardType: 'summary' | 'summary_large_image';

  if (firstImage) {
    const assetBase = options.assetBaseUrl || origin;
    const resolvedImageUrl = toAbsoluteUrl(firstImage, assetBase);
    imageUrl = appendCacheBuster(resolvedImageUrl, doc.updatedAt);
    cardType = 'summary_large_image';
  } else {
    imageUrl = defaultAbsoluteImageUrl;
    cardType = 'summary';
  }

  /** 検索エンジンのインデックス巡回を拒否するかどうかの判定。限定公開時や非公開時に除外する。 */
  const noindex = doc.visibility !== 'public';

  return {
    title: formattedTitle,
    description,
    imageUrl,
    cardType,
    noindex,
    canonicalUrl,
    ogType: 'article',
    publishedTime: doc.createdAt,
    modifiedTime: doc.updatedAt,
  };
}
