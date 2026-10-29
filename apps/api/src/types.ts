/**
 * Cloudflare Workers API の型定義。
 */

/**
 * Cloudflare Workers の環境バインディングおよびカスタム環境変数の型定義。
 * `wrangler types` で自動生成されるグローバルな `Env` 型のエイリアス。
 */
export type AppBindings = Env;

/**
 * Hono アプリケーションで使用する環境定義型。
 */
export type AppEnv = {
  Bindings: AppBindings;
};
