import { z } from 'zod';
import {
  ABUSE_REPORT_REASONS,
  MAX_ABUSE_REPORT_DETAILS_LENGTH,
} from '../constants/limits.ts';

/**
 * ドキュメント通報要求(`POST /api/documents/:id/report`)のバリデーションスキーマ。
 */
export const documentReportRequestSchema = z.object({
  /** 通報理由種別。 */
  reason: z.enum(ABUSE_REPORT_REASONS, {
    error: '通報理由を正しく選択してください。',
  }),

  /** 通報の詳細・補足説明(任意)。 */
  details: z
    .string()
    .max(
      MAX_ABUSE_REPORT_DETAILS_LENGTH,
      `詳細は${MAX_ABUSE_REPORT_DETAILS_LENGTH}文字以内で入力してください。`,
    )
    .optional(),
});

/** ドキュメント通報要求ペイロードの型。 */
export type DocumentReportRequest = z.infer<typeof documentReportRequestSchema>;

/**
 * ドキュメント通報受付レスポンス(`POST /api/documents/:id/report`)のスキーマ。
 */
export const documentReportResponseSchema = z.object({
  /** 処理成功フラグ。 */
  success: z.boolean(),

  /** 完了メッセージ。 */
  message: z.string(),
});

/** ドキュメント通報受付レスポンスの型。 */
export type DocumentReportResponse = z.infer<
  typeof documentReportResponseSchema
>;
