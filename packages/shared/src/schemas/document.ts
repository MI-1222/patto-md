import { z } from 'zod';
import {
  EXPIRATION_PRESETS,
  MAX_SINGLE_FILE_SIZE,
  MAX_TITLE_LENGTH,
  MIN_TITLE_LENGTH,
  SLUG_PATTERN,
} from '../constants/limits';

/** ドキュメントコミット要求に含まれる添付ファイルのメタデータスキーマ。 */
export const documentAttachmentCommitSchema = z.object({
  /** 添付ファイルID(UUID)。 */
  id: z.string().min(1, 'ファイルIDは必須である。'),

  /** アップロード元ファイル名。 */
  fileName: z
    .string()
    .min(1, 'ファイル名は必須である。')
    .max(255, 'ファイル名は255文字以下である必要がある。'),

  /** ファイルサイズ(バイト単位)。 */
  fileSize: z
    .number()
    .int('ファイルサイズは整数である必要がある。')
    .positive('ファイルサイズは正数である必要がある。')
    .max(MAX_SINGLE_FILE_SIZE, 'ファイルサイズが上限を超過している。'),

  /** ファイルのMIMEタイプ。 */
  mimeType: z.string().min(1, 'MIMEタイプは必須である。'),

  /** R2上のオブジェクトキー。 */
  r2Key: z.string().min(1, 'R2オブジェクトキーは必須である。'),
});

/** ドキュメントコミット要求に含まれる添付ファイルのメタデータ型。 */
export type DocumentAttachmentCommit = z.infer<
  typeof documentAttachmentCommitSchema
>;

/** ドキュメント確定コミット要求(POST /api/documents)のバリデーションスキーマ。 */
export const documentCommitRequestSchema = z.object({
  /** ドキュメントのタイトル。 */
  title: z
    .string()
    .trim()
    .min(MIN_TITLE_LENGTH, 'タイトルは必須である。')
    .max(
      MAX_TITLE_LENGTH,
      `タイトルは${MAX_TITLE_LENGTH}文字以下である必要がある。`,
    ),

  /** 本文の要約・抜粋テキスト(任意)。 */
  description: z
    .string()
    .max(500, '抜粋は500文字以下である必要がある。')
    .optional(),

  /** R2にアップロード済みのMarkdown本文のオブジェクトキー。 */
  contentR2Key: z.string().min(1, '本文のR2キーは必須である。'),

  /** ドキュメントに紐づく添付ファイル情報の一覧。 */
  attachments: z.array(documentAttachmentCommitSchema).default([]),

  /** 有効期限プリセット指定。 */
  expiration: z.enum(EXPIRATION_PRESETS, {
    error: '無効な有効期限指定である。',
  }),
});

/** ドキュメント確定コミット要求の型。 */
export type DocumentCommitRequest = z.infer<typeof documentCommitRequestSchema>;

/** ドキュメント確定コミットレスポンス(POST /api/documents)のスキーマ。 */
export const documentCommitResponseSchema = z.object({
  /** 発行されたドキュメントID(Slug)。 */
  id: z.string().regex(SLUG_PATTERN, '無効なSlug形式である。'),

  /** 公開パーマリンクURLまたはパス。 */
  url: z.string(),

  /** ドキュメントのタイトル。 */
  title: z.string(),

  /** 有効期限日時(ISO 8601文字列、無期限時はnull)。 */
  expiresAt: z.string().datetime().nullable(),

  /** 作成日時(ISO 8601文字列)。 */
  createdAt: z.string().datetime(),
});

/** ドキュメント確定コミットレスポンスの型。 */
export type DocumentCommitResponse = z.infer<
  typeof documentCommitResponseSchema
>;

/** ドキュメント詳細閲覧レスポンス(GET /api/documents/:id)のスキーマ。 */
export const documentResponseSchema = z.object({
  /** ドキュメントID(Slug)。 */
  id: z.string(),

  /** ドキュメントのタイトル。 */
  title: z.string(),

  /** Markdown本文の文字列。 */
  content: z.string(),

  /** 公開ステータス。 */
  status: z.enum(['published', 'expired', 'deleted', 'suspended']),

  /** 有効期限日時(ISO 8601文字列、無期限時はnull)。 */
  expiresAt: z.string().datetime().nullable(),

  /** 作成日時(ISO 8601文字列)。 */
  createdAt: z.string().datetime(),

  /** 最終更新日時(ISO 8601文字列)。 */
  updatedAt: z.string().datetime(),

  /** 添付ファイル一覧。 */
  attachments: z.array(documentAttachmentCommitSchema),
});

/** ドキュメント詳細閲覧レスポンスの型。 */
export type DocumentResponse = z.infer<typeof documentResponseSchema>;

/** ドキュメント一覧の単一項目スキーマ。 */
export const documentListItemSchema = z.object({
  /** ドキュメントID(`slug`)。 */
  id: z.string(),

  /** ドキュメントのタイトル。 */
  title: z.string(),

  /** 本文の要約・抜粋テキスト(未設定時は `null`)。 */
  description: z.string().nullable(),

  /** 有効期限日時(ISO 8601文字列、無期限時は `null`)。 */
  expiresAt: z.string().datetime().nullable(),

  /** 作成日時(ISO 8601文字列)。 */
  createdAt: z.string().datetime(),

  /** 添付ファイル数。 */
  attachmentCount: z.number().int().nonnegative(),
});

/** ドキュメント一覧の単一要素型。 */
export type DocumentListItem = z.infer<typeof documentListItemSchema>;

/** ドキュメント一覧取得レスポンス(`GET /api/documents`)のスキーマ。 */
export const documentListResponseSchema = z.object({
  /** ドキュメント一覧。 */
  items: z.array(documentListItemSchema),

  /** 検索条件に合致する総件数。 */
  total: z.number().int().nonnegative(),

  /** 現在のページ番号(1始まり)。 */
  page: z.number().int().positive(),

  /** 1ページあたりの最大取得件数。 */
  limit: z.number().int().positive(),

  /** 総ページ数。 */
  totalPages: z.number().int().nonnegative(),
});

/** ドキュメント一覧取得レスポンスの型。 */
export type DocumentListResponse = z.infer<typeof documentListResponseSchema>;
