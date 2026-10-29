import { SLUG_LENGTH, SLUG_PATTERN } from '@patto-md/shared';

/** Base62で使用する英数字の文字セット。 */
const BASE62_CHARACTERS =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * 暗号論的乱数を用いてBase62形式のドキュメントSlugを生成する。
 *
 * 剰余バイアス(Modulo Bias)を排除するため、256のうち62の最大倍数(248)未満のバイト値のみを採用する。
 *
 * @param length 生成するSlugの文字数(デフォルトは12文字)。
 * @returns 生成されたBase62文字列。
 */
export function generateSlug(length: number = SLUG_LENGTH): string {
  let result = '';
  const buffer = new Uint8Array(length * 2);
  let bufferIndex = buffer.length;

  while (result.length < length) {
    if (bufferIndex >= buffer.length) {
      crypto.getRandomValues(buffer);
      bufferIndex = 0;
    }

    const randomByte = buffer[bufferIndex++];
    // 62 * 4 = 248。248以上の値を除外することで偏りのない一様分布を担保する。
    if (randomByte < 248) {
      result += BASE62_CHARACTERS[randomByte % 62];
    }
  }

  // 生成結果が想定パターンに合致していることを確認する。
  if (!SLUG_PATTERN.test(result)) {
    throw new Error('生成されたSlugが仕様を満たしていません。');
  }

  return result;
}
