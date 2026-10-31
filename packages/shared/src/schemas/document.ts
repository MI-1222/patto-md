import { z } from 'zod';
import {
  DOCUMENT_VISIBILITIES,
  EXPIRATION_PRESETS,
  MAX_PASSCODE_LENGTH,
  MAX_SINGLE_FILE_SIZE,
  MAX_TITLE_LENGTH,
  MAX_TOTAL_FILE_SIZE,
  MIN_PASSCODE_LENGTH,
  MIN_TITLE_LENGTH,
  OAUTH_PROVIDERS,
  SLUG_PATTERN,
} from '../constants/limits.ts';
import {
  EDIT_TOKEN_PATTERN,
  MODIFY_TOKEN_PATTERN,
} from '../constants/tokens.ts';

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

/** ドキュメント確定コミット要求(`POST /api/documents`)のバリデーションスキーマ。 */
export const documentCommitRequestSchema = z
  .object({
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

    /** ドキュメント公開範囲。 */
    visibility: z.enum(DOCUMENT_VISIBILITIES).default('public'),

    /** パスコード保護時の平文パスコード(任意)。 */
    passcode: z
      .string()
      .max(
        MAX_PASSCODE_LENGTH,
        `パスコードは${MAX_PASSCODE_LENGTH}文字以下である必要がある。`,
      )
      .optional(),
  })
  .refine(
    (data) => {
      if (data.visibility === 'protected') {
        return (
          typeof data.passcode === 'string' &&
          data.passcode.length >= MIN_PASSCODE_LENGTH &&
          data.passcode.length <= MAX_PASSCODE_LENGTH
        );
      }
      return !data.passcode || data.passcode.trim().length === 0;
    },
    {
      message: `パスコード保護設定時は${MIN_PASSCODE_LENGTH}〜${MAX_PASSCODE_LENGTH}文字のパスコードが必須である。`,
      path: ['passcode'],
    },
  );

/** ドキュメント確定コミット要求の型。 */
export type DocumentCommitRequest = z.input<typeof documentCommitRequestSchema>;

/** ドキュメント確定コミットレスポンス(`POST /api/documents`)のスキーマ。 */
export const documentCommitResponseSchema = z.object({
  /** 発行されたドキュメントID(Slug)。 */
  id: z.string().regex(SLUG_PATTERN, '無効なSlug形式である。'),

  /** 公開パーマリンクURLまたはパス。 */
  url: z.string(),

  /** ドキュメントのタイトル。 */
  title: z.string(),

  /** 特権操作(削除・設定変更・所有権移譲)用トークン。 */
  editToken: z
    .string()
    .regex(EDIT_TOKEN_PATTERN, '無効なEdit Token形式である。'),

  /** 本文更新専用トークン。 */
  modifyToken: z
    .string()
    .regex(MODIFY_TOKEN_PATTERN, '無効なModify Token形式である。'),

  /** 有効期限日時(ISO 8601文字列、無期限時は `null`)。 */
  expiresAt: z.iso.datetime().nullable(),

  /** 作成日時(ISO 8601文字列)。 */
  createdAt: z.iso.datetime(),
});

/** ドキュメント確定コミットレスポンスの型。 */
export type DocumentCommitResponse = z.infer<
  typeof documentCommitResponseSchema
>;

/** ドキュメント詳細閲覧レスポンス(`GET /api/documents/:id`)のスキーマ。 */
export const documentResponseSchema = z.object({
  /** ドキュメントID(Slug)。 */
  id: z.string(),

  /** ドキュメントのタイトル。 */
  title: z.string(),

  /** Markdown本文の文字列。 */
  content: z.string(),

  /** ドキュメント公開範囲。 */
  visibility: z.enum(DOCUMENT_VISIBILITIES).default('public'),

  /** パスコード保護状態フラグ(未解除時は `true`)。 */
  isProtected: z.boolean().optional(),

  /** 公開ステータス。 */
  status: z.enum(['published', 'expired', 'deleted', 'suspended']),

  /** 所有者ユーザー識別子(`null` の場合は匿名ドキュメント)。 */
  ownerUserId: z.string().nullable().optional(),

  /** 所有者プロバイダ種別(`null` の場合は匿名ドキュメント)。 */
  ownerProvider: z.enum(OAUTH_PROVIDERS).nullable().optional(),

  /** 有効期限日時(ISO 8601文字列、無期限時は `null`)。 */
  expiresAt: z.iso.datetime().nullable(),

  /** 作成日時(ISO 8601文字列)。 */
  createdAt: z.iso.datetime(),

  /** 最終更新日時(ISO 8601文字列)。 */
  updatedAt: z.iso.datetime(),

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
  expiresAt: z.iso.datetime().nullable(),

  /** 作成日時(ISO 8601文字列)。 */
  createdAt: z.iso.datetime(),

  /** ドキュメント公開範囲(未指定時は `public`)。 */
  visibility: z.enum(DOCUMENT_VISIBILITIES).default('public').optional(),

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

/**
 * ドキュメント更新要求(`PUT /api/documents/:id`)のバリデーションスキーマ。
 * 本文ファイルサイズは署名要求時に検証済みのため、本スキーマでは添付ファイルの合計サイズ上限(30MB)を検証する。
 */
export const documentUpdateRequestSchema = z
  .object({
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

    /** R2にアップロード済みのMarkdown本文オブジェクトキー。 */
    contentR2Key: z.string().min(1, '本文のR2キーは必須である。'),

    /** ドキュメントに紐づく添付ファイル情報の一覧。 */
    attachments: z.array(documentAttachmentCommitSchema).default([]),

    /** ドキュメント公開範囲(未指定時は既存設定を維持)。 */
    visibility: z.enum(DOCUMENT_VISIBILITIES).optional(),

    /** パスコード保護時の平文パスコード(未指定時は既存設定を維持)。 */
    passcode: z
      .string()
      .max(
        MAX_PASSCODE_LENGTH,
        `パスコードは${MAX_PASSCODE_LENGTH}文字以下である必要がある。`,
      )
      .optional(),
  })
  .refine(
    (data) => {
      const totalSize = data.attachments.reduce(
        (sum, item) => sum + item.fileSize,
        0,
      );
      return totalSize <= MAX_TOTAL_FILE_SIZE;
    },
    {
      message: '添付ファイルの合計サイズが上限を超過している。',
      path: ['attachments'],
    },
  )
  .refine(
    (data) => {
      if (data.passcode !== undefined && data.passcode.trim().length > 0) {
        return (
          data.passcode.trim().length >= MIN_PASSCODE_LENGTH &&
          data.passcode.trim().length <= MAX_PASSCODE_LENGTH
        );
      }
      return true;
    },
    {
      message: `パスコードは${MIN_PASSCODE_LENGTH}〜${MAX_PASSCODE_LENGTH}文字である必要がある。`,
      path: ['passcode'],
    },
  );

/** ドキュメント更新要求の型。 */
export type DocumentUpdateRequest = z.infer<typeof documentUpdateRequestSchema>;

/** ドキュメント更新レスポンス(`PUT /api/documents/:id`)のスキーマ。 */
export const documentUpdateResponseSchema = z.object({
  /** ドキュメントID(`Slug`)。 */
  id: z.string(),

  /** 公開パーマリンクURLまたはパス。 */
  url: z.string(),

  /** ドキュメントのタイトル。 */
  title: z.string(),

  /** ドキュメント公開範囲。 */
  visibility: z.enum(DOCUMENT_VISIBILITIES).default('public'),

  /** 本文の要約・抜粋テキスト(`null` の場合は未設定)。 */
  description: z.string().nullable(),

  /** 有効期限日時(ISO 8601文字列、無期限時は `null`)。 */
  expiresAt: z.iso.datetime().nullable(),

  /** 作成日時(ISO 8601文字列)。 */
  createdAt: z.iso.datetime(),

  /** 最終更新日時(ISO 8601文字列)。 */
  updatedAt: z.iso.datetime(),
});

/** ドキュメント更新レスポンスの型。 */
export type DocumentUpdateResponse = z.infer<
  typeof documentUpdateResponseSchema
>;

/** ドキュメント再公開・有効期限延長要求(`POST /api/documents/:id/renew`)のスキーマ。 */
export const documentRenewRequestSchema = z.object({
  /** 新しい有効期限プリセット指定。 */
  expiration: z.enum(EXPIRATION_PRESETS, {
    error: '無効な有効期限指定である。',
  }),
});

/** ドキュメント再公開・有効期限延長要求の型。 */
export type DocumentRenewRequest = z.infer<typeof documentRenewRequestSchema>;

/** ドキュメント再公開・有効期限延長レスポンス(`POST /api/documents/:id/renew`)のスキーマ。 */
export const documentRenewResponseSchema = z.object({
  /** ドキュメントID(`Slug`)。 */
  id: z.string(),

  /** 公開パーマリンクURLまたはパス。 */
  url: z.string(),

  /** 更新後の有効期限日時(ISO 8601文字列、無期限時は `null`)。 */
  expiresAt: z.iso.datetime().nullable(),

  /** 最終更新日時(ISO 8601文字列)。 */
  updatedAt: z.iso.datetime(),
});

/** ドキュメント再公開・有効期限延長レスポンスの型。 */
export type DocumentRenewResponse = z.infer<typeof documentRenewResponseSchema>;

/** ドキュメント削除レスポンス(`DELETE /api/documents/:id`)のスキーマ。 */
export const documentDeleteResponseSchema = z.object({
  /** 削除成功フラグ。 */
  success: z.boolean(),

  /** 削除されたドキュメントID(`Slug`)。 */
  id: z.string(),
});

/** ドキュメント削除レスポンスの型。 */
export type DocumentDeleteResponse = z.infer<
  typeof documentDeleteResponseSchema
>;

/** パスコード照合要求(`POST /api/documents/:id/verify-passcode`)のスキーマ。 */
export const documentVerifyPasscodeRequestSchema = z.object({
  /** 照合対象のパスコード文字列。 */
  passcode: z.string().min(1, 'パスコードは必須である。'),
});

/** パスコード照合要求の型。 */
export type DocumentVerifyPasscodeRequest = z.infer<
  typeof documentVerifyPasscodeRequestSchema
>;

/** パスコード照合レスポンス(`POST /api/documents/:id/verify-passcode`)のスキーマ。 */
export const documentVerifyPasscodeResponseSchema = z.object({
  /** 照合成功フラグ。 */
  success: z.boolean(),

  /** 発行された閲覧認証トークン(`JWT`)。 */
  token: z.string().optional(),

  /** トークンの有効期限日時(ISO 8601文字列)。 */
  expiresAt: z.iso.datetime().optional(),
});

/** パスコード照合レスポンスの型。 */
export type DocumentVerifyPasscodeResponse = z.infer<
  typeof documentVerifyPasscodeResponseSchema
>;

/** 保護ドキュメントの未認証時情報スキーマ。 */
export const documentProtectedInfoSchema = z.object({
  /** ドキュメントID(`Slug`)。 */
  id: z.string(),

  /** ドキュメントのタイトル。 */
  title: z.string(),

  /** 公開範囲(`protected`)。 */
  visibility: z.literal('protected'),

  /** 保護状態フラグ(`true`)。 */
  isProtected: z.literal(true),

  /** 公開ステータス。 */
  status: z.enum(['published', 'expired', 'deleted', 'suspended']),

  /** 所有者ユーザー識別子(`null` の場合は匿名ドキュメント)。 */
  ownerUserId: z.string().nullable().optional(),

  /** 所有者プロバイダ種別(`null` の場合は匿名ドキュメント)。 */
  ownerProvider: z.enum(OAUTH_PROVIDERS).nullable().optional(),

  /** 有効期限日時(ISO 8601文字列、無期限時は `null`)。 */
  expiresAt: z.iso.datetime().nullable(),

  /** 作成日時(ISO 8601文字列)。 */
  createdAt: z.iso.datetime(),

  /** 最終更新日時(ISO 8601文字列)。 */
  updatedAt: z.iso.datetime(),

  /** 添付ファイル一覧(未認証時は空配列)。 */
  attachments: z.array(documentAttachmentCommitSchema).default([]),
});

/** 保護ドキュメントの未認証時情報の型。 */
export type DocumentProtectedInfo = z.infer<typeof documentProtectedInfoSchema>;

/** ドキュメント所有権移譲要求(`POST /api/documents/:id/claim`)のスキーマ。 */
export const documentClaimRequestSchema = z.object({
  /** ドキュメントの特権管理トークン(`edit_token`)。 */
  editToken: z
    .string()
    .regex(EDIT_TOKEN_PATTERN, '無効な管理トークン形式です。'),
});

/** ドキュメント所有権移譲要求の型。 */
export type DocumentClaimRequest = z.infer<typeof documentClaimRequestSchema>;

/** ドキュメント所有権移譲レスポンス(`POST /api/documents/:id/claim`)のスキーマ。 */
export const documentClaimResponseSchema = z.object({
  /** 移譲処理成功フラグ。 */
  success: z.boolean(),

  /** 対象ドキュメントID(`Slug`)。 */
  id: z.string(),

  /** 紐付けられた所有者ユーザー識別子。 */
  ownerUserId: z.string(),

  /** 紐付けられた所有者プロバイダ種別。 */
  ownerProvider: z.enum(OAUTH_PROVIDERS),

  /** 最終更新日時(ISO 8601文字列)。 */
  updatedAt: z.iso.datetime(),
});

/** ドキュメント所有権移譲レスポンスの型。 */
export type DocumentClaimResponse = z.infer<typeof documentClaimResponseSchema>;
