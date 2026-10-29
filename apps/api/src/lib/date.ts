import {
  EXPIRATION_SECONDS_MAP,
  type ExpirationPreset,
} from '@patto-md/shared';

/**
 * 有効期限プリセットに基づき、有効期限のISO 8601日時文字列を算出する。
 *
 * @param preset 有効期限プリセット('1day' | '7days' | '30days' | 'never')。
 * @param baseDate 算出の起点となる日時(省略時は現在日時)。
 * @returns ISO 8601形式の日時文字列。never指定時はnull。
 */
export function calculateExpiresAt(
  preset: ExpirationPreset,
  baseDate: Date = new Date(),
): string | null {
  const seconds = EXPIRATION_SECONDS_MAP[preset];
  if (seconds === null) {
    return null;
  }

  const expirationDate = new Date(baseDate.getTime() + seconds * 1000);
  return expirationDate.toISOString();
}
