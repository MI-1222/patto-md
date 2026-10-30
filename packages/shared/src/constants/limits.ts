/**
 * システム全体で共有する制約値および定数定義。
 */

/** 単一ファイルの最大サイズ(バイト単位、10MB)。 */
export const MAX_SINGLE_FILE_SIZE = 10 * 1024 * 1024;

/** ドキュメント全体の合計最大ファイルサイズ(バイト単位、30MB)。 */
export const MAX_TOTAL_FILE_SIZE = 30 * 1024 * 1024;

/** 許可する画像MIMEタイプのリスト。 */
export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
] as const;

/** 許可する画像MIMEタイプの型。 */
export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

/** 許可するテキストMIMEタイプのリスト。 */
export const ALLOWED_TEXT_MIME_TYPES = ['text/markdown', 'text/plain'] as const;

/** 許可するテキストMIMEタイプの型。 */
export type AllowedTextMimeType = (typeof ALLOWED_TEXT_MIME_TYPES)[number];

/** アップロードを許可する全MIMEタイプのリスト。 */
export const ALLOWED_MIME_TYPES = [
  ...ALLOWED_IMAGE_MIME_TYPES,
  ...ALLOWED_TEXT_MIME_TYPES,
] as const;

/** アップロードを許可するMIMEタイプの型。 */
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/** ドキュメントタイトルの最小文字数。 */
export const MIN_TITLE_LENGTH = 1;

/** ドキュメントタイトルの最大文字数。 */
export const MAX_TITLE_LENGTH = 100;

/** 公開用Slugの文字数(NanoID Base62)。 */
export const SLUG_LENGTH = 12;

/** 公開用Slugの検証用正規表現パターン。 */
export const SLUG_PATTERN = /^[A-Za-z0-9]{12}$/;

/** 有効期限プリセットの選択肢リスト。 */
export const EXPIRATION_PRESETS = ['1day', '7days', '30days', 'never'] as const;

/** 有効期限プリセットの型。 */
export type ExpirationPreset = (typeof EXPIRATION_PRESETS)[number];

/** 各有効期限プリセットに対応する秒数マッピング(neverはnull)。 */
export const EXPIRATION_SECONDS_MAP: Record<ExpirationPreset, number | null> = {
  '1day': 86400,
  '7days': 604800,
  '30days': 2592000,
  never: null,
};

/** R2 Presigned PUT URL の有効期限(秒単位、5分)。 */
export const PRESIGNED_URL_EXPIRATION_SECONDS = 300;

/** アップロード署名発行APIのレートリミット上限(1分あたりの最大リクエスト数)。 */
export const RATE_LIMIT_UPLOAD_SIGN_LIMIT = 10;

/** アップロード署名発行APIのレートリミットウィンドウ秒数(1分)。 */
export const RATE_LIMIT_UPLOAD_SIGN_WINDOW_SECONDS = 60;

/** ドキュメントコミットAPIのレートリミット上限(1分あたりの最大リクエスト数)。 */
export const RATE_LIMIT_DOCUMENT_COMMIT_LIMIT = 3;

/** ドキュメントコミットAPIのレートリミットウィンドウ秒数(1分)。 */
export const RATE_LIMIT_DOCUMENT_COMMIT_WINDOW_SECONDS = 60;

/** レートリミット超過時の既定エラーメッセージ。 */
export const RATE_LIMIT_EXCEEDED_MESSAGE =
  'リクエスト回数の上限を超えました。しばらく待ってから再試行してください。';
