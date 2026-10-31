/** Cloudflare Turnstile ボット防御に関する定数定義。 */

/** Turnstile トークンを伝達するためのカスタム HTTP リクエストヘッダー名。 */
export const TURNSTILE_TOKEN_HEADER = 'x-turnstile-token';

/** Cloudflare Turnstile 公式テスト用ダミーサイトキー (常に検証成功)。 */
export const TURNSTILE_TEST_SITE_KEY_PASS = '1x00000000000000000000AA';

/** Cloudflare Turnstile 公式テスト用ダミーシークレットキー (常に検証成功)。 */
export const TURNSTILE_TEST_SECRET_KEY_PASS =
  '1x0000000000000000000000000000000AA';

/** Cloudflare Turnstile 公式テスト用ダミーサイトキー (常に検証失敗)。 */
export const TURNSTILE_TEST_SITE_KEY_BLOCK = '2x00000000000000000000AB';

/** Cloudflare Turnstile 公式テスト用ダミーシークレットキー (常に検証失敗)。 */
export const TURNSTILE_TEST_SECRET_KEY_BLOCK =
  '2x0000000000000000000000000000000AB';

/** Cloudflare Turnstile の Siteverify API エンドポイント URL。 */
export const TURNSTILE_SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';
