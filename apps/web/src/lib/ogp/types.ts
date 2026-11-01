import type { DocumentVisibility } from '@patto-md/shared';

/** OGPおよびTwitter Cards用の解決済みメタデータ。 */
export interface OgpMetadata {
  /** ページタイトルおよび `og:title`、`twitter:title`。 */
  title: string;

  /** 説明文および `og:description`、`twitter:description`。 */
  description: string;

  /** 完全修飾絶対URL形式の画像URL (`og:image`、`twitter:image`)。 */
  imageUrl: string;

  /** Twitter Card 種別 (`summary` または `summary_large_image`)。 */
  cardType: 'summary' | 'summary_large_image';

  /** 検索エンジンのインデックス除外フラグ (`noindex, nofollow`)。 */
  noindex: boolean;

  /** 正規化されたパーマリンクURL (`og:url` および `canonical`)。 */
  canonicalUrl: string;

  /** OGP種別 (`website` または `article`)。 */
  ogType: 'website' | 'article';

  /** ドキュメント公開日時 (ISO 8601形式、`ogType === 'article'` 時に出力)。 */
  publishedTime?: string;

  /** ドキュメント最終更新日時 (ISO 8601形式、`ogType === 'article'` 時に出力)。 */
  modifiedTime?: string;
}

/** 添付ファイルのメタデータ情報 (OGP画像フォールバック解決用)。 */
export interface OgpAttachmentItem {
  /** R2オブジェクトキー。 */
  r2Key: string;

  /** ファイル名 (拡張子判定用)。 */
  fileName?: string;

  /** MIMEタイプ (SVG判定用)。 */
  mimeType?: string;
}

/** OGP解決対象のドキュメント情報。 */
export interface OgpDocumentSource {
  /** ドキュメント識別子 (`slug`)。 */
  id: string;

  /** ドキュメントのタイトル。 */
  title: string;

  /** 本文の要約・抜粋テキスト (`null` または未指定時は本文から抽出)。 */
  description?: string | null;

  /** Markdown本文実体。 */
  content?: string | null;

  /** パスコード保護フラグ。 */
  isProtected?: boolean;

  /** ドキュメントの公開範囲。 */
  visibility?: DocumentVisibility;

  /** 作成日時 (ISO 8601形式)。 */
  createdAt?: string;

  /** 最終更新日時 (ISO 8601形式)。 */
  updatedAt?: string;

  /** ドキュメントに紐づく添付ファイル一覧。 */
  attachments?: OgpAttachmentItem[];
}

/** OGPメタデータ解決オプション。 */
export interface ResolveOgpOptions {
  /** 現在のリクエストURL (またはベースURL)。 */
  currentUrl: URL | string;

  /**
   * `/api/assets/` で始まる内部アセットパスに前置するAPIベースURL。
   * 未指定時は `currentUrl` のオリジンを使用する。
   */
  assetBaseUrl?: string;

  /** デフォルトのサービス共通OGP画像パス。未指定時は `/ogp.jpeg`。 */
  defaultImagePath?: string;
}
