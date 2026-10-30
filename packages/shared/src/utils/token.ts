/** ケイパビリティトークンの生成、ハッシュ化、定数時間比較を行うユーティリティ。 */

import {
  EDIT_TOKEN_PREFIX,
  MODIFY_TOKEN_PREFIX,
  TOKEN_ENTROPY_BYTES,
  type CapabilityTokenType,
} from '../constants/tokens.ts';

/**
 * バイト配列をURLセーフなBase64文字列(パディングなし)へ変換する。
 *
 * @param bytes - 変換対象のバイト配列。
 * @returns URLセーフなBase64文字列。
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = globalThis.btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * 16進数文字列をバイト配列へ変換する。
 *
 * @param hex - 16進数文字列。
 * @returns バイト配列。形式が不正な場合は `null`。
 */
export function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * バイト配列を小文字の16進数文字列へ変換する。
 *
 * @param bytes - 変換対象のバイト配列。
 * @returns 16進数文字列。
 */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * 256ビット(32バイト)の暗号論的乱数に基づき、ケイパビリティトークンを生成する。
 *
 * @param type - トークン種別(`edit` または `modify`)。
 * @returns プレフィックスを付与した推測不能なトークン文字列。
 */
export function generateCapabilityToken(type: CapabilityTokenType): string {
  const bytes = new Uint8Array(TOKEN_ENTROPY_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  const rawToken = bytesToBase64Url(bytes);
  const prefix = type === 'edit' ? EDIT_TOKEN_PREFIX : MODIFY_TOKEN_PREFIX;
  return `${prefix}${rawToken}`;
}

/**
 * トークン文字列を SHA-256 でハッシュ化し、小文字の16進数文字列(64文字)として返却する。
 *
 * @param token - ハッシュ化対象のトークン文字列。
 * @returns SHA-256 ハッシュ文字列(Hex 64文字)。
 */
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const digestBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digestBuffer));
}

/**
 * 2つの16進数ハッシュ文字列を定数時間で安全に比較する。
 * 文字列の早期終了比較によるタイミング攻撃を防止する。
 * Web Crypto API の `timingSafeEqual` が利用可能な環境ではそれを優先し、
 * 未提供環境ではバイト単位の XOR 演算で定数時間比較を行う。
 *
 * @param hexA - 比較対象ハッシュ文字列A。
 * @param hexB - 比較対象ハッシュ文字列B。
 * @returns 一致する場合は `true`、不一致または形式不正時は `false`。
 */
export function timingSafeEqualHex(hexA: string, hexB: string): boolean {
  if (hexA.length !== hexB.length) {
    return false;
  }
  const bytesA = hexToBytes(hexA);
  const bytesB = hexToBytes(hexB);
  if (!bytesA || !bytesB) {
    return false;
  }
  if (bytesA.byteLength !== bytesB.byteLength) {
    return false;
  }

  const subtleWithTimingSafeEqual = globalThis.crypto?.subtle as
    | { timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean }
    | undefined;
  if (typeof subtleWithTimingSafeEqual?.timingSafeEqual === 'function') {
    try {
      return subtleWithTimingSafeEqual.timingSafeEqual(bytesA, bytesB);
    } catch {
      return false;
    }
  }

  let diff = 0;
  for (let i = 0; i < bytesA.byteLength; i++) {
    diff |= bytesA[i] ^ bytesB[i];
  }
  return diff === 0;
}

/**
 * 入力された平文トークンが、期待されるハッシュ値と一致するか検証する。
 *
 * @param plainToken - 検証対象の平文トークン。
 * @param expectedHash - 期待されるSHA-256ハッシュ文字列(`null` または未設定時は常に不一致と判定)。
 * @returns 一致する場合は `true`、それ以外は `false`。
 */
export async function verifyTokenHash(
  plainToken: string,
  expectedHash: string | null | undefined,
): Promise<boolean> {
  if (!plainToken || !expectedHash) {
    return false;
  }
  const actualHash = await hashToken(plainToken);
  return timingSafeEqualHex(actualHash, expectedHash);
}
