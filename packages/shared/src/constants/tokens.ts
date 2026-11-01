/** トークン関連の定数定義。 */

/** 特権管理トークン(`Edit Token`)のプレフィックス。 */
export const EDIT_TOKEN_PREFIX = 'pt_edt_';

/** 本文更新専用トークン(`Modify Token`)のプレフィックス。 */
export const MODIFY_TOKEN_PREFIX = 'pt_mod_';

/** パーソナルアクセストークン(`PAT`)のプレフィックス。 */
export const PATTO_PAT_PREFIX = 'pmd_pat_';

/** トークン生成に用いるエントロピーのバイト長(256ビット = 32バイト)。 */
export const TOKEN_ENTROPY_BYTES = 32;

/** 32バイトの乱数をURLセーフなBase64(パディングなし)へ変換した文字列長。 */
export const TOKEN_RAW_BASE64_LENGTH = 43;

/** Base62形式のPATトークン本体の文字数(43文字で256ビット相当のエントロピーを確保)。 */
export const PAT_RAW_LENGTH = 43;

/** 特権管理トークン全体の正規表現パターン。 */
export const EDIT_TOKEN_PATTERN = /^pt_edt_[A-Za-z0-9_-]{43}$/;

/** 本文更新専用トークン全体の正規表現パターン。 */
export const MODIFY_TOKEN_PATTERN = /^pt_mod_[A-Za-z0-9_-]{43}$/;

/** いずれかのケイパビリティトークンに合致する正規表現パターン。 */
export const CAPABILITY_TOKEN_PATTERN = /^pt_(edt|mod)_[A-Za-z0-9_-]{43}$/;

/** パーソナルアクセストークン(`PAT`)全体の正規表現パターン。 */
export const PAT_PATTERN = /^pmd_pat_[A-Za-z0-9]{43}$/;

/** トークンの種別を表す型(`edit` または `modify`)。 */
export type CapabilityTokenType = 'edit' | 'modify';

/** PATの識別名における最小文字数。 */
export const MIN_PAT_NAME_LENGTH = 1;

/** PATの識別名における最大文字数。 */
export const MAX_PAT_NAME_LENGTH = 50;

/** PATに付与可能な認可スコープの一覧。 */
export const TOKEN_SCOPES = [
  'documents:read',
  'documents:write',
  'documents:delete',
] as const;

/** PAT認可スコープの型。 */
export type TokenScope = (typeof TOKEN_SCOPES)[number];

/** PAT有効期限プリセットの選択肢一覧。 */
export const TOKEN_EXPIRATION_PRESETS = [
  '30days',
  '90days',
  '1year',
  'never',
] as const;

/** PAT有効期限プリセットの型。 */
export type TokenExpirationPreset = (typeof TOKEN_EXPIRATION_PRESETS)[number];

/** 各PAT有効期限プリセットに対応する秒数マッピング(`never` の場合は `null`)。 */
export const TOKEN_EXPIRATION_SECONDS_MAP: Record<
  TokenExpirationPreset,
  number | null
> = {
  '30days': 30 * 24 * 60 * 60,
  '90days': 90 * 24 * 60 * 60,
  '1year': 365 * 24 * 60 * 60,
  never: null,
};
