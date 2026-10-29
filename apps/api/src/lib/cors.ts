/**
 * CORS(Cross-Origin Resource Sharing)オリジン判定ユーティリティ。
 */

/**
 * リクエスト送信元オリジンが許可対象であるかを判定する。
 * ローカル開発環境、指定されたフロントエンドオリジン、
 * および Cloudflare Pages のプレビュー・本番ドメイン（*.pages.dev）を許可する。
 *
 * @param origin - 判定対象の Origin ヘッダー文字列。
 * @param configuredOrigin - 環境変数から取得したフロントエンドオリジン。
 * @returns 許可される場合は該当オリジン文字列、不許可の場合は null。
 */
export function resolveAllowedOrigin(
  origin: string,
  configuredOrigin?: string,
): string | null {
  if (!origin) {
    return null;
  }

  // ローカル開発用オリジン。
  const localOrigins = ['http://localhost:4321', 'http://127.0.0.1:4321'];
  if (localOrigins.includes(origin)) {
    return origin;
  }

  // 明示的に設定されたフロントエンドオリジン。
  if (
    configuredOrigin &&
    origin === configuredOrigin.trim().replace(/\/+$/, '')
  ) {
    return origin;
  }

  // Cloudflare Pages ドメイン（プレビュー環境含む *.pages.dev）。
  const pagesDevPattern = /^https:\/\/([a-zA-Z0-9-]+\.)*pages\.dev$/;
  if (pagesDevPattern.test(origin)) {
    return origin;
  }

  return null;
}
