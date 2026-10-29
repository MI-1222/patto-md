/**
 * Cloudflare Workers API の型定義。
 */

/**
 * Cloudflare Workers の環境バインディングおよびカスタム環境変数のインターフェース。
 * `wrangler types` で自動生成されるグローバルな `Env` インターフェースを拡張する。
 */
export interface AppBindings extends Env {
  /** アプリケーション実行環境(development, production 等)。 */
  ENVIRONMENT?: string;
}

/**
 * Hono アプリケーションで使用する環境定義型。
 */
export type AppEnv = {
  Bindings: AppBindings;
};
