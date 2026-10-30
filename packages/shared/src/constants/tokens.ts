/** ケイパビリティトークン関連の定数定義。 */

/** 特権管理トークン(`Edit Token`)のプレフィックス。 */
export const EDIT_TOKEN_PREFIX = 'pt_edt_';

/** 本文更新専用トークン(`Modify Token`)のプレフィックス。 */
export const MODIFY_TOKEN_PREFIX = 'pt_mod_';

/** トークン生成に用いるエントロピーのバイト長(256ビット = 32バイト)。 */
export const TOKEN_ENTROPY_BYTES = 32;

/** 32バイトの乱数をURLセーフなBase64(パディングなし)へ変換した文字列長。 */
export const TOKEN_RAW_BASE64_LENGTH = 43;

/** 特権管理トークン全体の正規表現パターン。 */
export const EDIT_TOKEN_PATTERN = /^pt_edt_[A-Za-z0-9_-]{43}$/;

/** 本文更新専用トークン全体の正規表現パターン。 */
export const MODIFY_TOKEN_PATTERN = /^pt_mod_[A-Za-z0-9_-]{43}$/;

/** いずれかのケイパビリティトークンに合致する正規表現パターン。 */
export const CAPABILITY_TOKEN_PATTERN = /^pt_(edt|mod)_[A-Za-z0-9_-]{43}$/;

/** トークンの種別を表す型(`edit` または `modify`)。 */
export type CapabilityTokenType = 'edit' | 'modify';
