/** パスコードのハッシュ化および検証ユーティリティ。 */

import { bytesToHex, hexToBytes, timingSafeEqualHex } from '@patto-md/shared';

/** `PBKDF2` の反復計算回数(Cloudflare Workers の CPU 時間制約と安全性のバランスを考慮した設定値)。 */
export const PASSCODE_PBKDF2_ITERATIONS = 50000;

/** パスコードソルトのバイト長(128ビット)。 */
export const PASSCODE_SALT_BYTES = 16;

/** パスコード派生キーのビット長(256ビット)。 */
export const PASSCODE_KEY_BITS = 256;

/**
 * 平文パスコードから暗号論的乱数ソルトを用いた `PBKDF2` ハッシュ文字列を生成する。
 *
 * 返却形式は `${saltHex}:${hashHex}` となる。
 *
 * @param passcode - 平文パスコード文字列。
 * @returns ソルトとハッシュがコロンで連結された16進数文字列。
 */
export async function hashPasscode(passcode: string): Promise<string> {
  const salt = new Uint8Array(PASSCODE_SALT_BYTES);
  globalThis.crypto.getRandomValues(salt);

  const encoder = new TextEncoder();
  const passwordKey = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(passcode),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const derivedBits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: PASSCODE_PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    PASSCODE_KEY_BITS,
  );

  const saltHex = bytesToHex(salt);
  const hashHex = bytesToHex(new Uint8Array(derivedBits));

  return `${saltHex}:${hashHex}`;
}

/**
 * 平文パスコードと保存済みのハッシュ文字列を定数時間で照合する。
 *
 * @param passcode - 照合対象の平文パスコード。
 * @param storedHash - 保存された `${saltHex}:${hashHex}` 形式の文字列。
 * @returns 一致する場合は `true`、不一致または形式不正時は `false`。
 */
export async function verifyPasscode(
  passcode: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  if (!storedHash || typeof storedHash !== 'string') {
    return false;
  }

  const parts = storedHash.split(':');
  if (parts.length !== 2) {
    return false;
  }

  const [saltHex, expectedHashHex] = parts;
  if (!saltHex || !expectedHashHex) {
    return false;
  }

  const salt = hexToBytes(saltHex);
  if (!salt || salt.byteLength !== PASSCODE_SALT_BYTES) {
    return false;
  }

  const encoder = new TextEncoder();
  const passwordKey = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(passcode),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const derivedBits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: PASSCODE_PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    PASSCODE_KEY_BITS,
  );

  const computedHashHex = bytesToHex(new Uint8Array(derivedBits));
  return timingSafeEqualHex(computedHashHex, expectedHashHex);
}
