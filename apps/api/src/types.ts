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

  /** フロントエンドの許可オリジンURL。 */
  FRONTEND_ORIGIN?: string;

  /** R2 Direct Upload用 S3互換アクセスキーID。 */
  R2_ACCESS_KEY_ID?: string;

  /** R2 Direct Upload用 S3互換シークレットアクセスキー。 */
  R2_SECRET_ACCESS_KEY?: string;

  /** Cloudflare アカウントID。 */
  CLOUDFLARE_ACCOUNT_ID?: string;
}

/**
 * Hono アプリケーションで使用する環境定義型。
 */
export type AppEnv = {
  Bindings: AppBindings;
};
