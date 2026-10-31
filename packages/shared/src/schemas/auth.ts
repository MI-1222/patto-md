/** OAuth認証およびセッション関連のバリデーションスキーマおよび型定義。 */
import { z } from 'zod';
import { OAUTH_PROVIDERS } from '../constants/limits.ts';

/** OAuth対応プロバイダ種別の `Zod` スキーマ。 */
export const oauthProviderSchema = z.enum(OAUTH_PROVIDERS);

/** 認証済みユーザー情報の `Zod` スキーマ。 */
export const authUserSchema = z.object({
  /** 不変認証プロバイダ種別(`github` または `discord`)。 */
  provider: oauthProviderSchema,

  /** プロバイダ側で一意な不変ユーザー識別子文字列。 */
  providerUserId: z.string().min(1),

  /** 表示用ユーザー名。 */
  username: z.string().min(1),

  /** アバター画像URL(未設定時は `null`)。 */
  avatarUrl: z.string().url().nullable(),
});

/** 認証済みユーザー情報型。 */
export type AuthUser = z.infer<typeof authUserSchema>;

/** 認証セッション情報取得(`/api/auth/me`)レスポンスの `Zod` スキーマ。 */
export const authMeResponseSchema = z.object({
  /** ログイン中のユーザー情報(未認証時は `null`)。 */
  user: authUserSchema.nullable(),
});

/** 認証セッション情報取得レスポンス型。 */
export type AuthMeResponse = z.infer<typeof authMeResponseSchema>;

/** ログアウト(`/api/auth/logout`)レスポンスの `Zod` スキーマ。 */
export const authLogoutResponseSchema = z.object({
  /** 処理成功フラグ。 */
  success: z.boolean(),
});

/** ログアウトレスポンス型。 */
export type AuthLogoutResponse = z.infer<typeof authLogoutResponseSchema>;
