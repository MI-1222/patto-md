import { z } from 'zod';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  EXPIRATION_PRESETS,
  MAX_SINGLE_FILE_SIZE,
  MAX_TITLE_LENGTH,
  MAX_TOTAL_FILE_SIZE,
  MIN_TITLE_LENGTH,
  SLUG_PATTERN,
} from '../constants/limits.ts';

/** MCP 経由でアップロードされる添付画像アイテムのバリデーションスキーマ。 */
export const mcpImageItemSchema = z.object({
  /** Markdown 本文内で参照されている相対パスまたはファイル名(例: `./images/arch.png`, `arch.png`)。 */
  path: z
    .string()
    .min(1, '画像パスの指定が必要です。')
    .max(255, '画像パスは255文字以内で指定してください。')
    .describe('Markdown 本文内の相対パス(例: `./images/arch.png`)'),

  /**
   * 画像データの Base64 文字列。
   *
   * 文字長から概算バイト数(約0.75倍)を算出し、単一ファイル上限以下かを事前検証する。
   */
  base64Data: z
    .string()
    .min(1, 'Base64データの指定が必要です。')
    .refine(
      (data) => {
        const estimatedSize = Math.ceil((data.length * 3) / 4);
        return estimatedSize <= MAX_SINGLE_FILE_SIZE;
      },
      {
        message: `単一画像のサイズは最大${MAX_SINGLE_FILE_SIZE / (1024 * 1024)}MBまでです。`,
      },
    )
    .describe('画像データの Base64 文字列(単一最大10MB)'),

  /** 画像の MIME タイプ。 */
  mimeType: z
    .enum(ALLOWED_IMAGE_MIME_TYPES, {
      error: '許可されていない画像形式です。',
    })
    .describe(
      '画像の MIME タイプ(`image/png`, `image/jpeg`, `image/webp`, `image/gif`, `image/svg+xml`)',
    ),
});

/** MCP 添付画像アイテムの型。 */
export type McpImageItem = z.infer<typeof mcpImageItemSchema>;

/** ドキュメント公開ツール(`publish_document`)の入力バリデーションスキーマ。 */
export const mcpPublishDocumentSchema = z.object({
  /** ドキュメントのタイトル。 */
  title: z
    .string()
    .min(MIN_TITLE_LENGTH, 'タイトルの指定が必要です。')
    .max(MAX_TITLE_LENGTH, `タイトルは最大${MAX_TITLE_LENGTH}文字までです。`)
    .describe('ドキュメントのタイトル(1〜100文字)'),

  /** Markdown 本文。 */
  content: z
    .string()
    .min(1, '本文の入力が必要です。')
    .describe('Markdown 本文'),

  /** ドキュメントの要約・抜粋(任意)。 */
  description: z
    .string()
    .max(500, '要約は最大500文字までです。')
    .optional()
    .describe('ドキュメントの要約・抜粋(任意、最大500文字)'),

  /** 有効期限プリセット(既定値: `'7days'`)。 */
  expiration: z
    .enum(EXPIRATION_PRESETS, {
      error: '無効な有効期限の指定です。',
    })
    .default('7days')
    .describe('有効期限プリセット(1day, 7days, 30days, never。既定値: 7days)'),

  /** 公開範囲(既定値: `'unlisted'`)。 */
  visibility: z
    .enum(['public', 'unlisted', 'protected'], {
      error: '無効な公開範囲の指定です。',
    })
    .default('unlisted')
    .describe('公開範囲(public, unlisted, protected。既定値: unlisted)'),

  /** パスコード保護時の暗証番号(任意、4〜32文字)。 */
  passcode: z
    .string()
    .min(4, 'パスコードは4文字以上で指定してください。')
    .max(32, 'パスコードは32文字以内で指定してください。')
    .optional()
    .describe(
      'パスコード保護時の暗証番号(visibilityがprotectedの場合に有効、4〜32文字)',
    ),

  /**
   * 添付画像リスト(任意、最大10件)。
   *
   * 登録された全画像の概算合計サイズがシステム上限以下かを事前検証する。
   */
  images: z
    .array(mcpImageItemSchema)
    .max(10, '添付画像は最大10件までです。')
    .refine(
      (images) => {
        const totalEstimatedSize = images.reduce((sum, img) => {
          return sum + Math.ceil((img.base64Data.length * 3) / 4);
        }, 0);
        return totalEstimatedSize <= MAX_TOTAL_FILE_SIZE;
      },
      {
        message: `添付画像の合計サイズは最大${MAX_TOTAL_FILE_SIZE / (1024 * 1024)}MBまでです。`,
      },
    )
    .optional()
    .describe('添付画像リスト(最大10件、単一最大10MB、合計最大30MB)'),
});

/** ドキュメント公開ツールの入力型。 */
export type McpPublishDocumentInput = z.infer<typeof mcpPublishDocumentSchema>;

/** ドキュメント更新ツール(`update_document`)の入力バリデーションスキーマ。 */
export const mcpUpdateDocumentSchema = z.object({
  /** 対象ドキュメントの Slug(12文字)。 */
  id: z
    .string()
    .regex(SLUG_PATTERN, '無効なドキュメントID形式です。')
    .describe('更新対象ドキュメントのID(Slug 12文字)'),

  /** 更新後の Markdown 本文。 */
  content: z
    .string()
    .min(1, '本文の入力が必要です。')
    .describe('更新後の Markdown 本文'),

  /** 更新後のドキュメントタイトル(任意)。未指定時は既存維持。 */
  title: z
    .string()
    .min(MIN_TITLE_LENGTH, 'タイトルの指定が必要です。')
    .max(MAX_TITLE_LENGTH, `タイトルは最大${MAX_TITLE_LENGTH}文字までです。`)
    .optional()
    .describe('更新後のタイトル(任意。未指定時は既存維持)'),

  /** 更新後の要約・抜粋(任意)。 */
  description: z
    .string()
    .max(500, '要約は最大500文字までです。')
    .optional()
    .describe('更新後の要約・抜粋(任意)'),

  /** 更新後の公開範囲(任意)。 */
  visibility: z
    .enum(['public', 'unlisted', 'protected'], {
      error: '無効な公開範囲の指定です。',
    })
    .optional()
    .describe('更新後の公開範囲(任意)'),

  /** 更新後のパスコード(任意)。 */
  passcode: z
    .string()
    .min(4, 'パスコードは4文字以上で指定してください。')
    .max(32, 'パスコードは32文字以内で指定してください。')
    .optional()
    .describe('更新後のパスコード(任意)'),

  /**
   * 新規追加添付画像リスト(任意、最大10件)。
   *
   * 登録された全画像の概算合計サイズがシステム上限以下かを事前検証する。
   */
  images: z
    .array(mcpImageItemSchema)
    .max(10, '添付画像は最大10件までです。')
    .refine(
      (images) => {
        const totalEstimatedSize = images.reduce((sum, img) => {
          return sum + Math.ceil((img.base64Data.length * 3) / 4);
        }, 0);
        return totalEstimatedSize <= MAX_TOTAL_FILE_SIZE;
      },
      {
        message: `添付画像の合計サイズは最大${MAX_TOTAL_FILE_SIZE / (1024 * 1024)}MBまでです。`,
      },
    )
    .optional()
    .describe('新規追加する添付画像リスト(任意)'),
});

/** ドキュメント更新ツールの入力型。 */
export type McpUpdateDocumentInput = z.infer<typeof mcpUpdateDocumentSchema>;

/** ドキュメント取得ツール(`get_document`)の入力バリデーションスキーマ。 */
export const mcpGetDocumentSchema = z.object({
  /** 取得対象ドキュメントの Slug(12文字)。 */
  id: z
    .string()
    .regex(SLUG_PATTERN, '無効なドキュメントID形式です。')
    .describe('取得対象ドキュメントのID(Slug 12文字)'),

  /** パスコード保護時の暗証番号(任意)。 */
  passcode: z
    .string()
    .min(4, 'パスコードは4文字以上で指定してください。')
    .max(32, 'パスコードは32文字以内で指定してください。')
    .optional()
    .describe('パスコード保護ドキュメント閲覧時の暗証番号(任意)'),
});

/** ドキュメント取得ツールの入力型。 */
export type McpGetDocumentInput = z.infer<typeof mcpGetDocumentSchema>;
