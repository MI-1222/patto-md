/**
 * Cloudflare Workers API の型定義。
 */

/**
 * Cloudflare Workers の環境バインディングおよび環境変数のインターフェース。
 */
export interface Env {
  /** Cloudflare D1 データベースインスタンス。 */
  DB: D1Database;

  /** Cloudflare R2 オブジェクトストレージバケット。 */
  BUCKET: R2Bucket;

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
  Bindings: Env;
};
