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

/** 有効期限プリセットに対応するR2オブジェクトキーのプレフィックスマッピング。 */
export const EXPIRATION_R2_PREFIX_MAP: Record<ExpirationPreset, string> = {
  '1day': 'exp-1d/',
  '7days': 'exp-7d/',
  '30days': 'exp-30d/',
  never: 'permanent/',
};

/** R2オブジェクトキーの有効期限プレフィックス型。 */
export type ExpirationR2Prefix =
  (typeof EXPIRATION_R2_PREFIX_MAP)[ExpirationPreset];

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

/** ドキュメント更新APIのレートリミット上限(1分あたりの最大リクエスト数)。 */
export const RATE_LIMIT_DOCUMENT_UPDATE_LIMIT = 5;

/** ドキュメント更新APIのレートリミットウィンドウ秒数(1分)。 */
export const RATE_LIMIT_DOCUMENT_UPDATE_WINDOW_SECONDS = 60;

/** ドキュメント削除APIのレートリミット上限(1分あたりの最大リクエスト数)。 */
export const RATE_LIMIT_DOCUMENT_DELETE_LIMIT = 5;

/** ドキュメント削除APIのレートリミットウィンドウ秒数(1分)。 */
export const RATE_LIMIT_DOCUMENT_DELETE_WINDOW_SECONDS = 60;

/** ドキュメント再公開・有効期限延長APIのレートリミット上限(1分あたりの最大リクエスト数)。 */
export const RATE_LIMIT_DOCUMENT_RENEW_LIMIT = 5;

/** ドキュメント再公開・有効期限延長APIのレートリミットウィンドウ秒数(1分)。 */
export const RATE_LIMIT_DOCUMENT_RENEW_WINDOW_SECONDS = 60;

/** ドキュメント所有権移譲(Claim)APIのレートリミット上限(1分あたりの最大リクエスト数)。 */
export const RATE_LIMIT_DOCUMENT_CLAIM_LIMIT = 5;

/** ドキュメント所有権移譲(Claim)APIのレートリミットウィンドウ秒数(1分)。 */
export const RATE_LIMIT_DOCUMENT_CLAIM_WINDOW_SECONDS = 60;

/** パスコード照合APIのレートリミット上限(1分あたりの最大リクエスト数)。 */
export const RATE_LIMIT_VERIFY_PASSCODE_LIMIT = 5;

/** パスコード照合APIのレートリミットウィンドウ秒数(1分)。 */
export const RATE_LIMIT_VERIFY_PASSCODE_WINDOW_SECONDS = 60;

/** ドキュメント公開範囲の選択肢リスト。 */
export const DOCUMENT_VISIBILITIES = [
  'public',
  'unlisted',
  'protected',
] as const;

/** パスコードの最小文字数。 */
export const MIN_PASSCODE_LENGTH = 4;

/** パスコードの最大文字数。 */
export const MAX_PASSCODE_LENGTH = 32;

/** 閲覧認証トークン(`JWT`)の有効期限(秒単位、24時間)。 */
export const VIEW_TOKEN_EXPIRATION_SECONDS = 86400;

/** パスコード認証 `Cookie` 名のプレフィックス。 */
export const PASSCODE_AUTH_COOKIE_PREFIX = 'patto_doc_auth_';

/** レートリミット超過時の既定エラーメッセージ。 */
export const RATE_LIMIT_EXCEEDED_MESSAGE =
  'リクエスト回数の上限を超えました。しばらく待ってから再試行してください。';

/** OAuth対応プロバイダの選択肢リスト。 */
export const OAUTH_PROVIDERS = ['discord', 'github'] as const;

/** OAuth対応プロバイダ種別の型。 */
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** OAuthセッション認証 `Cookie` 名。 */
export const AUTH_SESSION_COOKIE_NAME = 'patto_session';

/** OAuth CSRF対策用 `state` `Cookie` 名。 */
export const OAUTH_STATE_COOKIE_NAME = 'patto_oauth_state';

/** OAuthリダイレクト先復帰用 `Cookie` 名。 */
export const OAUTH_RETURN_TO_COOKIE_NAME = 'patto_oauth_return_to';

/** OAuthセッションの有効期限(秒単位、7日間)。 */
export const AUTH_SESSION_EXPIRATION_SECONDS = 7 * 24 * 60 * 60;

/** OAuth `state` `Cookie` の有効期限(秒単位、5分間)。 */
export const OAUTH_STATE_EXPIRATION_SECONDS = 300;

/** OAuth認可開始APIのレートリミット上限(1分あたりの最大リクエスト数)。 */
export const RATE_LIMIT_AUTH_START_LIMIT = 10;

/** OAuth認可開始APIのレートリミットウィンドウ秒数(1分)。 */
export const RATE_LIMIT_AUTH_START_WINDOW_SECONDS = 60;

/** OAuthコールバック受信APIのレートリミット上限(1分あたりの最大リクエスト数)。 */
export const RATE_LIMIT_AUTH_CALLBACK_LIMIT = 10;

/** OAuthコールバック受信APIのレートリミットウィンドウ秒数(1分)。 */
export const RATE_LIMIT_AUTH_CALLBACK_WINDOW_SECONDS = 60;

/** 通報理由の選択肢リスト。 */
export const ABUSE_REPORT_REASONS = [
  'spam',
  'phishing',
  'malware',
  'illegal',
  'other',
] as const;

/** 通報理由種別の型。 */
export type AbuseReportReason = (typeof ABUSE_REPORT_REASONS)[number];

/** 通報理由の表示用ラベルマッピング。 */
export const ABUSE_REPORT_REASON_LABELS: Record<AbuseReportReason, string> = {
  spam: 'スパム・広告目的の投稿',
  phishing: 'フィッシング・詐欺サイトへの誘導',
  malware: 'マルウェア・悪意あるスクリプトの配布',
  illegal: '違法コンテンツ・著作権侵害',
  other: 'その他（利用規約違反）',
};

/** 通報詳細テキストの最大文字数。 */
export const MAX_ABUSE_REPORT_DETAILS_LENGTH = 500;

/** 通報APIのレートリミット上限(1分あたりの最大リクエスト数)。 */
export const RATE_LIMIT_DOCUMENT_REPORT_LIMIT = 3;

/** 通報APIのレートリミットウィンドウ秒数(1分)。 */
export const RATE_LIMIT_DOCUMENT_REPORT_WINDOW_SECONDS = 60;
