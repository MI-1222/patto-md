import {
  RATE_LIMIT_UPLOAD_SIGN_LIMIT,
  RATE_LIMIT_UPLOAD_SIGN_WINDOW_SECONDS,
  uploadSignRequestSchema,
  type UploadSignFileResponseItem,
  type UploadSignResponse,
  z,
} from '@patto-md/shared';
import { Hono } from 'hono';
import { createPresignedPutUrl, generateR2Key } from '../lib/r2';
import { createRateLimitMiddleware } from '../middlewares/rate-limit';
import { createTurnstileMiddleware } from '../middlewares/turnstile';
import type { AppEnv } from '../types';

/** ファイルアップロード関連のサブルーター。 */
export const uploadRouter = new Hono<AppEnv>();

/**
 * R2 直接アップロード用 Presigned PUT URL 発行エンドポイント。
 *
 * クライアントから受け取ったファイルメタデータを検証し、
 * ブラウザから R2 へ直接 PUT するための短命な署名付き URL を発行する。
 * 1分あたり最大10リクエストのレートリミットおよび Turnstile ボット検証を適用する。
 */
uploadRouter.post(
  '/sign',
  createRateLimitMiddleware({
    action: 'upload-sign',
    limit: RATE_LIMIT_UPLOAD_SIGN_LIMIT,
    windowSeconds: RATE_LIMIT_UPLOAD_SIGN_WINDOW_SECONDS,
  }),
  createTurnstileMiddleware(),
  async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json(
        {
          error: {
            message: '不正なJSON形式のリクエスト。',
          },
        },
        400,
      );
    }

    // Zodスキーマによるバリデーション(サイズ制限・MIMEタイプ・合計サイズ判定)。
    const parseResult = uploadSignRequestSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return c.json(
        {
          error: {
            message: 'ファイルメタデータの検証に失敗しました。',
            details: z.flattenError(parseResult.error),
          },
        },
        400,
      );
    }

    const { files } = parseResult.data;

    // 署名生成に必要な環境変数の存在確認。
    const accountId = c.env.CLOUDFLARE_ACCOUNT_ID;
    const accessKeyId = c.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = c.env.R2_SECRET_ACCESS_KEY;
    const bucketName = c.env.R2_BUCKET_NAME;

    if (!accountId || !accessKeyId || !secretAccessKey) {
      console.error(
        'R2クレデンシャルの取得に失敗しました。CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY を設定してください。',
      );
      return c.json(
        {
          error: {
            message: 'ストレージ連携用環境変数が設定されていません。',
          },
        },
        500,
      );
    }

    try {
      // 各ファイルに対してUUID採番およびPresigned URLを生成する。
      const signedFiles: UploadSignFileResponseItem[] = await Promise.all(
        files.map(async (file) => {
          const fileId = crypto.randomUUID();
          const r2Key = generateR2Key(fileId, file.name);

          const uploadUrl = await createPresignedPutUrl({
            accountId,
            accessKeyId,
            secretAccessKey,
            bucketName,
            r2Key,
          });

          return {
            fileId,
            fileName: file.name,
            r2Key,
            uploadUrl,
          };
        }),
      );

      const responsePayload: UploadSignResponse = {
        files: signedFiles,
      };

      return c.json(responsePayload, 200);
    } catch (error) {
      console.error('Presigned URLの生成に失敗しました:', error);
      return c.json(
        {
          error: {
            message: '署名付きURLの発行に失敗しました。',
          },
        },
        500,
      );
    }
  },
);
