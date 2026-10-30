/** Cloudflare Workers API の型定義。 */

import type {
  CapabilityTokenType,
  DocumentVisibility,
  OwnerProvider,
} from '@patto-md/shared';

/**
 * Cloudflare Workers の環境バインディングおよびカスタム環境変数の型定義。
 * (`wrangler types` で自動生成されるグローバルな `Env` 型のエイリアス)
 */
export type AppBindings = Env;

/** 認証済みドキュメント情報レコード。 */
export interface AuthenticatedDocument {
  /** ドキュメントID(Slug)。 */
  id: string;

  /** ドキュメントのタイトル。 */
  title: string;

  /** 本文の要約・抜粋(`null` の場合は未設定)。 */
  description: string | null;

  /** R2上に保存されたMarkdown本文のオブジェクトキー。 */
  content_r2_key: string;

  /** ドキュメントの公開ステータス。 */
  status: string;

  /** 有効期限日時(ISO 8601文字列、`null` の場合は無期限)。 */
  expires_at: string | null;

  /** 特権操作用トークンの `SHA-256` ハッシュ値。 */
  edit_token_hash: string | null;

  /** 本文更新専用トークンの `SHA-256` ハッシュ値。 */
  modify_token_hash: string | null;

  /** 所有者ユーザー識別子。 */
  owner_user_id: string | null;

  /** 所有者認証プロバイダ種別。 */
  owner_provider: OwnerProvider | null;

  /** 公開範囲。 */
  visibility: DocumentVisibility;

  /** パスコード照合用ハッシュ値。 */
  passcode_hash: string | null;

  /** レコード作成日時(ISO 8601文字列)。 */
  created_at: string;

  /** レコード最終更新日時(ISO 8601文字列)。 */
  updated_at: string;
}

/** 認証トークンにより認可されたロール(`edit` または `modify`)。 */
export type CapabilityTokenRole = CapabilityTokenType;

/** Hono アプリケーションで使用する環境定義型。 */
export type AppEnv = {
  Bindings: AppBindings;
  Variables: {
    /** 認証ミドルウェアによって検証・解決されたドキュメントレコード。 */
    authDoc?: AuthenticatedDocument;
    /** 検証されたトークンの認可ロール(`edit` または `modify`)。 */
    tokenRole?: CapabilityTokenRole;
  };
};
