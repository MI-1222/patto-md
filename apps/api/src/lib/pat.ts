/** パーソナルアクセストークン(PAT)の生成、暗号学的ハッシュ化、定数時間照合ユーティリティ。 */

import {
  PAT_PATTERN,
  PAT_RAW_LENGTH,
  PATTO_PAT_PREFIX,
  TOKEN_EXPIRATION_SECONDS_MAP,
  hashToken,
  timingSafeEqualHex,
  type TokenExpirationPreset,
} from '@patto-md/shared';

/** Base62 で使用する英数字の文字セット。 */
const BASE62_CHARACTERS =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * 暗号論的乱数(CSPRNG)を用いて、256ビット相当のエントロピーを持つ Base62 形式の PAT 文字列を生成する。
 *
 * 剰余バイアス(Modulo Bias）を排除するため、
 * 256のうち62の最大倍数（248 = 62 × 4)未満のバイト値のみを採用し、
 * 偏りのない一様分布を担保する。
 * 43文字の Base62 表現により、
 * 256ビット(約 $1.15 \times 10^{77}$ 通り）を上回る空間（約 $3.22 \times 10^{77}$ 通り)を確保する。
 *
 * @returns プレフィックス `pmd_pat_` を付与した高エントロピートークン文字列。
 */
export function generatePat(): string {
  let rawToken = '';
  const buffer = new Uint8Array(PAT_RAW_LENGTH * 2);
  let bufferIndex = buffer.length;

  while (rawToken.length < PAT_RAW_LENGTH) {
    if (bufferIndex >= buffer.length) {
      crypto.getRandomValues(buffer);
      bufferIndex = 0;
    }

    const randomByte = buffer[bufferIndex++];
    if (randomByte < 248) {
      rawToken += BASE62_CHARACTERS[randomByte % 62];
    }
  }

  const token = `${PATTO_PAT_PREFIX}${rawToken}`;

  if (!PAT_PATTERN.test(token)) {
    throw new Error('生成されたPATが仕様を満たしていません。');
  }

  return token;
}

/**
 * 平文 PAT トークンを SHA-256 でハッシュ化し、小文字の Hex 64文字として返す。
 *
 * @param token - ハッシュ化対象の平文トークン文字列。
 * @returns SHA-256 ハッシュ文字列(小文字 Hex 64文字)。
 */
export async function hashPat(token: string): Promise<string> {
  return hashToken(token);
}

/**
 * 平文 PAT トークンが、期待されるハッシュ値と一致するかを定数時間で安全に検証する。
 * タイミング攻撃による秘密情報の漏洩を防止する。
 *
 * @param plainToken - クライアントから渡された平文トークン。
 * @param expectedHash - データベースに保存されている期待 SHA-256 ハッシュ文字列。
 * @returns 一致する場合は `true`、不一致または形式不正時は `false`。
 */
export async function verifyPat(
  plainToken: string,
  expectedHash: string | null | undefined,
): Promise<boolean> {
  if (!plainToken || !expectedHash) {
    return false;
  }
  const actualHash = await hashPat(plainToken);
  return timingSafeEqualHex(actualHash, expectedHash);
}

/**
 * 文字列がパーソナルアクセストークン(PAT)の正規形式を満たしているか判定する。
 *
 * @param token - 判定対象の文字列。
 * @returns 有効な PAT 形式の場合は `true`、それ以外は `false`。
 */
export function isPat(token: string): boolean {
  if (!token || typeof token !== 'string') {
    return false;
  }
  return PAT_PATTERN.test(token);
}

/**
 * 有効期限プリセットに基づき、失効日時(ISO 8601 形式)を算出する。
 *
 * @param preset - 有効期限プリセット(`30days`, `90days`, `1year`, `never`)。
 * @param baseDate - 基準日時(未指定時は現在日時)。
 * @returns ISO 8601 形式の文字列。無期限(`never`)の場合は `null`。
 */
export function calculatePatExpiration(
  preset: TokenExpirationPreset,
  baseDate: Date = new Date(),
): string | null {
  const seconds = TOKEN_EXPIRATION_SECONDS_MAP[preset];
  if (seconds === null) {
    return null;
  }
  const expiresAt = new Date(baseDate.getTime() + seconds * 1000);
  return expiresAt.toISOString();
}

/**
 * 平文 PAT トークンから表示・ログ用のマスク文字列を生成する。
 * プレフィックスおよび末尾4文字のみを残し、中間を秘匿する。
 *
 * @param token - 平文トークン文字列。
 * @returns マスクされた表示用文字列(例: `pmd_pat_...a1b2`)。
 */
export function maskPat(token: string): string {
  if (!token || !token.startsWith(PATTO_PAT_PREFIX)) {
    return `${PATTO_PAT_PREFIX}...`;
  }
  if (token.length < PATTO_PAT_PREFIX.length + 4) {
    return `${token}...`;
  }
  const suffix = token.slice(-4);
  return `${PATTO_PAT_PREFIX}...${suffix}`;
}
