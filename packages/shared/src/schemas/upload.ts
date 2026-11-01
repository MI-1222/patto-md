import { z } from 'zod';
import {
  ALLOWED_MIME_TYPES,
  EXPIRATION_PRESETS,
  MAX_SINGLE_FILE_SIZE,
  MAX_TOTAL_FILE_SIZE,
} from '../constants/limits.ts';

/** アップロード署名要求における単一ファイルのバリデーションスキーマ。 */
export const uploadSignFileItemSchema = z.object({
  /** ファイル名(拡張子を含む)。 */
  name: z
    .string()
    .min(1, 'ファイル名は必須である。')
    .max(255, 'ファイル名は255文字以下である必要がある。'),

  /** ファイルサイズ(バイト単位)。 */
  size: z
    .number()
    .int('ファイルサイズは整数である必要がある。')
    .positive('ファイルサイズは正数である必要がある。')
    .max(
      MAX_SINGLE_FILE_SIZE,
      `単一ファイルのサイズは最大${MAX_SINGLE_FILE_SIZE / (1024 * 1024)}MBまでである。`,
    ),

  /** ファイルのMIMEタイプ。 */
  type: z.enum(ALLOWED_MIME_TYPES, {
    error: '許可されていないファイル形式である。',
  }),
});

/** アップロード署名要求における単一ファイルの型。 */
export type UploadSignFileItem = z.infer<typeof uploadSignFileItemSchema>;

/** R2 Presigned PUT 署名発行要求(POST /api/upload/sign)のバリデーションスキーマ。 */
export const uploadSignRequestSchema = z.object({
  /** 署名を要求するファイル一覧。 */
  files: z
    .array(uploadSignFileItemSchema)
    .min(1, '少なくとも1つのファイルを指定する必要がある。')
    .refine(
      (files) => {
        const totalSize = files.reduce((sum, file) => sum + file.size, 0);
        return totalSize <= MAX_TOTAL_FILE_SIZE;
      },
      {
        message: `合計ファイルサイズは最大${MAX_TOTAL_FILE_SIZE / (1024 * 1024)}MBまでである。`,
      },
    ),

  /** 有効期限プリセット指定(任意)。未指定時は既定の有効期限が適用される。 */
  expiration: z
    .enum(EXPIRATION_PRESETS, {
      error: '無効な有効期限の指定。',
    })
    .optional(),
});

/** R2 Presigned PUT 署名発行要求の型。 */
export type UploadSignRequest = z.infer<typeof uploadSignRequestSchema>;

/** 署名発行レスポンスにおける単一ファイルのスキーマ。 */
export const uploadSignFileResponseItemSchema = z.object({
  /** 発行されたファイルID(UUID)。 */
  fileId: z.string(),

  /** 元のファイル名。 */
  fileName: z.string(),

  /** R2上に配置されるオブジェクトキー。 */
  r2Key: z.string(),

  /** 直接アップロード用のPresigned PUT URL。 */
  uploadUrl: z.string().url(),
});

/** 署名発行レスポンスにおける単一ファイルの型。 */
export type UploadSignFileResponseItem = z.infer<
  typeof uploadSignFileResponseItemSchema
>;

/** R2 Presigned PUT 署名発行レスポンス(POST /api/upload/sign)のスキーマ。 */
export const uploadSignResponseSchema = z.object({
  /** 署名済みURL情報の一覧。 */
  files: z.array(uploadSignFileResponseItemSchema),
});

/** R2 Presigned PUT 署名発行レスポンスの型。 */
export type UploadSignResponse = z.infer<typeof uploadSignResponseSchema>;
