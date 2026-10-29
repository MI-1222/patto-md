import {
  documentCommitRequestSchema,
  type AttachmentRecord,
  type DocumentCommitResponse,
  type DocumentRecord,
  type DocumentResponse,
  SLUG_PATTERN,
} from '@patto-md/shared';
import { Hono } from 'hono';
import { calculateDocumentCacheControl } from '../lib/cache';
import { calculateExpiresAt } from '../lib/date';
import { isValidR2Key } from '../lib/r2';
import { generateSlug } from '../lib/slug';
import type { AppEnv } from '../types';

/** ドキュメント管理関連のサブルーター。 */
export const documentsRouter = new Hono<AppEnv>();

/**
 * ドキュメントコミットエンドポイント。
 *
 * R2への直接アップロード完了後、メタデータと添付ファイル情報をD1へアトミックに永続化し、
 * 公開用のドキュメントSlugおよびパーマリンクを発行する。
 */
documentsRouter.post('/', async (c) => {
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

  // Zodスキーマによるリクエストボディの検証。
  const parseResult = documentCommitRequestSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return c.json(
      {
        error: {
          message: 'ドキュメント情報の検証に失敗しました。',
          details: parseResult.error.flatten(),
        },
      },
      400,
    );
  }

  const { title, contentR2Key, attachments, expiration } = parseResult.data;

  // R2オブジェクトキーの形式およびパストラバーサル検証。
  if (!isValidR2Key(contentR2Key)) {
    return c.json(
      {
        error: {
          message: '不正な本文ストレージキーが指定されました。',
        },
      },
      400,
    );
  }

  for (const attachment of attachments) {
    if (!isValidR2Key(attachment.r2Key)) {
      return c.json(
        {
          error: {
            message: `添付ファイル「${attachment.fileName}」のストレージキーが不正です。`,
          },
        },
        400,
      );
    }
  }

  // R2上のMarkdown本文実体の存在確認。
  try {
    const contentHead = await c.env.BUCKET.head(contentR2Key);
    if (!contentHead) {
      return c.json(
        {
          error: {
            message: '指定された本文ファイルがストレージ上に存在しません。',
          },
        },
        400,
      );
    }

    // 添付ファイル群の実体存在確認。
    if (attachments.length > 0) {
      const checkResults = await Promise.all(
        attachments.map(async (attachment) => {
          const headResult = await c.env.BUCKET.head(attachment.r2Key);
          return {
            fileName: attachment.fileName,
            exists: headResult !== null,
          };
        }),
      );

      const missingAttachment = checkResults.find((result) => !result.exists);
      if (missingAttachment) {
        return c.json(
          {
            error: {
              message: `添付ファイル「${missingAttachment.fileName}」がストレージ上に存在しません。`,
            },
          },
          400,
        );
      }
    }
  } catch (error) {
    console.error('R2オブジェクト存在確認エラー:', error);
    return c.json(
      {
        error: {
          message: 'ストレージの検証中にエラーが発生しました。',
        },
      },
      500,
    );
  }

  // 作成日時および有効期限日時の決定(ISO 8601形式で統一)。
  const createdAt = new Date().toISOString();
  const updatedAt = createdAt;
  const expiresAt = calculateExpiresAt(expiration, new Date(createdAt));

  // D1へのアトミックコミット(主キー衝突時は最大3回リトライ)。
  const maxRetries = 3;
  let committedSlug: string | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const candidateSlug = generateSlug();

    // ドキュメント本体の登録ステートメント。
    const documentStatement = c.env.DB.prepare(
      `INSERT INTO documents (
        id,
        title,
        content_r2_key,
        status,
        expires_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, 'published', ?, ?, ?)`,
    ).bind(candidateSlug, title, contentR2Key, expiresAt, createdAt, updatedAt);

    // 添付ファイル群の登録ステートメント配列(外部キー順序を担保)。
    const attachmentStatements = attachments.map((attachment) => {
      return c.env.DB.prepare(
        `INSERT INTO attachments (
          id,
          document_id,
          file_name,
          file_size,
          mime_type,
          r2_key,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        attachment.id,
        candidateSlug,
        attachment.fileName,
        attachment.fileSize,
        attachment.mimeType,
        attachment.r2Key,
        createdAt,
      );
    });

    try {
      // 単一トランザクション内で一括実行する。
      await c.env.DB.batch([documentStatement, ...attachmentStatements]);
      committedSlug = candidateSlug;
      break;
    } catch (error) {
      lastError = error;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // 主キーの一意性制約違反時はリトライを実施する。
      if (
        errorMessage.includes('UNIQUE constraint failed') ||
        errorMessage.includes('PRIMARY KEY')
      ) {
        console.warn(
          `Slug衝突を検知しました(${candidateSlug})。再試行中(${attempt + 1}/${maxRetries})...`,
        );
        continue;
      }

      // その他のDBエラー時はリトライせず中断する。
      console.error('D1データベース書き込みエラー:', error);
      return c.json(
        {
          error: {
            message: 'データベースの書き込みに失敗しました。',
          },
        },
        500,
      );
    }
  }

  if (!committedSlug) {
    console.error('Slug生成とD1コミットのリトライ上限超過:', lastError);
    return c.json(
      {
        error: {
          message: 'ドキュメント識別子の採番に失敗しました。',
        },
      },
      500,
    );
  }

  // 確定コミットレスポンスの形成。
  const responsePayload: DocumentCommitResponse = {
    id: committedSlug,
    url: `/p/${committedSlug}`,
    title,
    expiresAt,
    createdAt,
  };

  return c.json(responsePayload, 201);
});

/**
 * ドキュメント詳細取得およびコンテンツ配信エンドポイント。
 *
 * 指定されたSlugに基づき、D1からメタデータを取得してオンデマンドで有効期限を判定する。
 * 有効なドキュメントであれば、R2からMarkdown本文実体を取得し、残存有効期限に応じた
 * Cache-Controlヘッダーを付与して返却する。
 */
documentsRouter.get('/:id', async (c) => {
  const id = c.req.param('id');

  // Slug形式の事前検証(不正リクエストによるD1クォータ消費を防止)。
  if (!id || !SLUG_PATTERN.test(id)) {
    c.header('Cache-Control', 'no-store');
    return c.json(
      {
        error: {
          message: 'ドキュメントが見つかりません。',
        },
      },
      404,
    );
  }

  const now = new Date();
  const nowIso = now.toISOString();

  // D1からのメタデータ取得およびオンデマンド有効期限判定(遅延評価)。
  let doc: DocumentRecord | null = null;
  try {
    doc = await c.env.DB.prepare(
      `SELECT
        id,
        title,
        content_r2_key,
        status,
        expires_at,
        created_at,
        updated_at
      FROM documents
      WHERE id = ?
        AND status = 'published'
        AND (expires_at IS NULL OR expires_at > ?)
      LIMIT 1`,
    )
      .bind(id, nowIso)
      .first<DocumentRecord>();
  } catch (error) {
    console.error('D1ドキュメントメタデータ取得エラー:', error);
    return c.json(
      {
        error: {
          message: 'データベースの参照に失敗しました。',
        },
      },
      500,
    );
  }

  // レコードが存在しない、または期限切れの場合は404を返却する。
  if (!doc) {
    c.header('Cache-Control', 'no-store');
    return c.json(
      {
        error: {
          message: 'ドキュメントが見つかりません。',
        },
      },
      404,
    );
  }

  // 紐づく添付ファイル一覧の取得。
  let attachments: AttachmentRecord[] = [];
  try {
    const attachmentResults = await c.env.DB.prepare(
      `SELECT
        id,
        document_id,
        file_name,
        file_size,
        mime_type,
        r2_key,
        created_at
      FROM attachments
      WHERE document_id = ?
      ORDER BY created_at ASC`,
    )
      .bind(id)
      .all<AttachmentRecord>();

    attachments = attachmentResults.results ?? [];
  } catch (error) {
    console.error('D1添付ファイル情報取得エラー:', error);
    return c.json(
      {
        error: {
          message: '添付ファイルの参照に失敗しました。',
        },
      },
      500,
    );
  }

  // R2からのMarkdown本文実体取得。
  let content = '';
  try {
    const object = await c.env.BUCKET.get(doc.content_r2_key);
    if (!object) {
      console.error(`R2オブジェクト欠落エラー: ${doc.content_r2_key}`);
      return c.json(
        {
          error: {
            message: 'ドキュメント本文が見つかりません。',
          },
        },
        500,
      );
    }
    content = await object.text();
  } catch (error) {
    console.error('R2ドキュメント本文読み込みエラー:', error);
    return c.json(
      {
        error: {
          message: 'ドキュメント本文の読み込みに失敗しました。',
        },
      },
      500,
    );
  }

  // 残存有効期間に基づくCache-Controlヘッダーの付与。
  const cacheControl = calculateDocumentCacheControl(doc.expires_at, now);
  c.header('Cache-Control', cacheControl);

  // レスポンスの構築(スネークケースからキャメルケースへの変換)。
  const responsePayload: DocumentResponse = {
    id: doc.id,
    title: doc.title,
    content,
    status: doc.status,
    expiresAt: doc.expires_at,
    createdAt: doc.created_at,
    updatedAt: doc.updated_at,
    attachments: attachments.map((attachment) => ({
      id: attachment.id,
      fileName: attachment.file_name,
      fileSize: attachment.file_size,
      mimeType: attachment.mime_type,
      r2Key: attachment.r2_key,
    })),
  };

  return c.json(responsePayload, 200);
});
