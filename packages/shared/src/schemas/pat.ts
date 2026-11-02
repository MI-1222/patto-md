/** パーソナルアクセストークン(PAT)関連のバリデーションスキーマおよび型定義。 */

import { z } from 'zod';
import {
  MAX_PAT_NAME_LENGTH,
  MIN_PAT_NAME_LENGTH,
  PAT_PATTERN,
  TOKEN_EXPIRATION_PRESETS,
  TOKEN_SCOPES,
} from '../constants/tokens.ts';

/** PAT認可スコープの `Zod` スキーマ。 */
export const tokenScopeSchema = z.enum(TOKEN_SCOPES);

/** PAT有効期限プリセットの `Zod` スキーマ。 */
export const tokenExpirationPresetSchema = z.enum(TOKEN_EXPIRATION_PRESETS);

/** PAT新規発行要求(`POST /api/user/tokens`)の `Zod` スキーマ。 */
export const createPatRequestSchema = z.object({
  /** トークンの識別表示名。 */
  name: z
    .string()
    .trim()
    .min(MIN_PAT_NAME_LENGTH, 'トークン名を入力してください。')
    .max(
      MAX_PAT_NAME_LENGTH,
      `トークン名は${MAX_PAT_NAME_LENGTH}文字以内で入力してください。`,
    ),

  /** 付与する認可スコープ配列(1件以上必須。重複は自動排除)。 */
  scopes: z
    .array(tokenScopeSchema)
    .min(1, '少なくとも1つのスコープを選択してください。')
    .transform((scopes) => Array.from(new Set(scopes))),

  /** 有効期限プリセット。 */
  expiration: tokenExpirationPresetSchema,
});

/** PAT新規発行要求の型。 */
export type CreatePatRequest = z.input<typeof createPatRequestSchema>;

/** PAT新規発行要求の検証済み型。 */
export type CreatePatRequestValidated = z.output<typeof createPatRequestSchema>;

/** PAT新規発行レスポンス(`POST /api/user/tokens`)の `Zod` スキーマ。平文トークンを含む唯一の返却形式。 */
export const createPatResponseSchema = z.object({
  /** 発行されたトークンの一意識別子(UUID)。 */
  id: z.string(),

  /** トークンの識別表示名。 */
  name: z.string(),

  /** 生成された平文PAT文字列(再取得不可)。 */
  token: z.string().regex(PAT_PATTERN, '無効なPAT形式です。'),

  /** 付与された認可スコープ配列。 */
  scopes: z.array(tokenScopeSchema),

  /** 有効期限日時(ISO 8601 形式の文字列。無期限の場合は `null`)。 */
  expiresAt: z.iso.datetime().nullable(),

  /** 作成日時(ISO 8601 形式の文字列)。 */
  createdAt: z.iso.datetime(),
});

/** PAT新規発行レスポンスの型。 */
export type CreatePatResponse = z.infer<typeof createPatResponseSchema>;

/** 発行済みPAT一覧アイテムの `Zod` スキーマ。平文およびハッシュ値は秘匿する。 */
export const userApiTokenItemSchema = z.object({
  /** トークンの一意識別子(UUID)。 */
  id: z.string(),

  /** トークンの識別表示名。 */
  name: z.string(),

  /** マスクされたトークン表示文字列(例: `pmd_pat_...abcd`)。 */
  tokenMasked: z.string(),

  /** 付与された認可スコープ配列。 */
  scopes: z.array(tokenScopeSchema),

  /** 有効期限日時(ISO 8601 形式の文字列。無期限の場合は `null`)。 */
  expiresAt: z.iso.datetime().nullable(),

  /** 最終利用日時(ISO 8601 形式の文字列。未利用時は `null`)。 */
  lastUsedAt: z.iso.datetime().nullable(),

  /** 作成日時(ISO 8601 形式の文字列)。 */
  createdAt: z.iso.datetime(),
});

/** 発行済みPAT一覧アイテムの型。 */
export type UserApiTokenItem = z.infer<typeof userApiTokenItemSchema>;

/** 発行済みPAT一覧取得レスポンス(`GET /api/user/tokens`)の `Zod` スキーマ。 */
export const userApiTokenListResponseSchema = z.object({
  /** 発行済みトークンのリスト。 */
  tokens: z.array(userApiTokenItemSchema),
});

/** 発行済みPAT一覧取得レスポンスの型。 */
export type UserApiTokenListResponse = z.infer<
  typeof userApiTokenListResponseSchema
>;

/** PAT失効・削除レスポンス(`DELETE /api/user/tokens/:id`)の `Zod` スキーマ。 */
export const deletePatResponseSchema = z.object({
  /** 処理成功フラグ。 */
  success: z.boolean(),
});

/** PAT失効・削除レスポンスの型。 */
export type DeletePatResponse = z.infer<typeof deletePatResponseSchema>;
