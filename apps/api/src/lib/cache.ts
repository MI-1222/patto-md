/**
 * キャッシュ制御関連のユーティリティ。
 */

/** ブラウザ向けのデフォルト最大キャッシュ時間(秒単位、1分)。 */
export const DEFAULT_MAX_AGE_SECONDS = 60;

/** CDNエッジ向けのデフォルト最大キャッシュ時間(秒単位、5分)。 */
export const DEFAULT_S_MAXAGE_SECONDS = 300;

/** エッジキャッシュをバイパスする残存秒数のしきい値(秒単位)。 */
export const CACHE_BYPASS_THRESHOLD_SECONDS = 10;

/**
 * 有効期限に基づき、動的なCache-Controlヘッダー値を算出する。
 *
 * 有効期限が迫っているドキュメントに対して固定のs-maxageを設定すると、
 * 期限超過後もCDNエッジキャッシュからコンテンツが配信され続ける問題(過剰キャッシュ)が発生する。
 * そのため、残存秒数に応じてmax-ageおよびs-maxageを動的に調整する。
 *
 * @param expiresAt ISO 8601形式の有効期限日時文字列。無期限の場合はnull。
 * @param now 算出の起点となる現在日時(省略時は現在時刻)。
 * @returns Cache-Controlヘッダー文字列。
 */
export function calculateDocumentCacheControl(
  expiresAt: string | null,
  now: Date = new Date(),
): string {
  // 無期限の場合はデフォルトのエッジキャッシュ設定を返却する。
  if (!expiresAt) {
    return `public, max-age=${DEFAULT_MAX_AGE_SECONDS}, s-maxage=${DEFAULT_S_MAXAGE_SECONDS}`;
  }

  const expiresTime = new Date(expiresAt).getTime();
  const nowTime = now.getTime();
  const remainingSeconds = Math.floor((expiresTime - nowTime) / 1000);

  // 既に期限切れ、または残存期間が極めて短い場合はキャッシュをバイパスする。
  if (remainingSeconds <= CACHE_BYPASS_THRESHOLD_SECONDS) {
    return 'no-cache';
  }

  const sMaxAge = Math.min(DEFAULT_S_MAXAGE_SECONDS, remainingSeconds);
  const maxAge = Math.min(DEFAULT_MAX_AGE_SECONDS, remainingSeconds);

  return `public, max-age=${maxAge}, s-maxage=${sMaxAge}`;
}
