import {
  documentCommitRequestSchema,
  generateCapabilityToken,
  hashToken,
  RATE_LIMIT_DOCUMENT_COMMIT_LIMIT,
  RATE_LIMIT_DOCUMENT_COMMIT_WINDOW_SECONDS,
  type AttachmentRecord,
  type DocumentCommitResponse,
  type DocumentListItem,
  type DocumentListResponse,
  type DocumentRecord,
  type DocumentResponse,
  SLUG_PATTERN,
} from '@patto-md/shared';
import { Hono } from 'hono';
import { calculateDocumentCacheControl } from '../lib/cache';
import { calculateExpiresAt } from '../lib/date';
import { checkR2ObjectExists, getR2Text, isValidR2Key } from '../lib/r2';
import { generateSlug } from '../lib/slug';
import { createRateLimitMiddleware } from '../middlewares/rate-limit';
import type { AppEnv } from '../types';

/** ドキュメント管理関連のサブルーター。 */
export const documentsRouter = new Hono<AppEnv>();

/**
 * ドキュメントコミットエンドポイント。
 *
 * R2 への直接アップロード完了後、メタデータと添付ファイル情報を D1 へアトミックに永続化し、
 * 公開用のドキュメント Slug およびパーマリンクを発行する。
 * 1分あたり最大3リクエストのレートリミットを適用する。
 */
documentsRouter.post(
  '/',
  createRateLimitMiddleware({
    action: 'document-commit',
    limit: RATE_LIMIT_DOCUMENT_COMMIT_LIMIT,
    windowSeconds: RATE_LIMIT_DOCUMENT_COMMIT_WINDOW_SECONDS,
  }),
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

    const { title, description, contentR2Key, attachments, expiration } =
      parseResult.data;

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

    const r2Creds = {
      accountId: c.env.CLOUDFLARE_ACCOUNT_ID,
      accessKeyId: c.env.R2_ACCESS_KEY_ID,
      secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
      bucketName: c.env.R2_BUCKET_NAME,
    };

    // R2上のMarkdown本文実体の存在確認(ローカル開発時S3フォールバック対応)。
    try {
      const contentExists = await checkR2ObjectExists(
        c.env.BUCKET,
        contentR2Key,
        r2Creds,
      );
      if (!contentExists) {
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
            const exists = await checkR2ObjectExists(
              c.env.BUCKET,
              attachment.r2Key,
              r2Creds,
            );
            return {
              fileName: attachment.fileName,
              exists,
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

    const editToken = generateCapabilityToken('edit');
    const modifyToken = generateCapabilityToken('modify');
    const [editTokenHash, modifyTokenHash] = await Promise.all([
      hashToken(editToken),
      hashToken(modifyToken),
    ]);

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
        description,
        content_r2_key,
        status,
        expires_at,
        edit_token_hash,
        modify_token_hash,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, 'published', ?, ?, ?, ?, ?)`,
      ).bind(
        candidateSlug,
        title,
        description ?? null,
        contentR2Key,
        expiresAt,
        editTokenHash,
        modifyTokenHash,
        createdAt,
        updatedAt,
      );

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

    const responsePayload: DocumentCommitResponse = {
      id: committedSlug,
      url: `/p/${committedSlug}`,
      title,
      editToken,
      modifyToken,
      expiresAt,
      createdAt,
    };

    return c.json(responsePayload, 201);
  },
);

/** D1のドキュメント一覧クエリが返却するレコード型。 */
interface DocumentListRow {
  /** ドキュメントID(`slug`)。 */
  id: string;
  /** ドキュメントのタイトル。 */
  title: string;
  /** 本文の要約・抜粋(`null` の場合は未設定)。 */
  description: string | null;
  /** 有効期限日時(ISO 8601文字列、無期限時は `null`)。 */
  expires_at: string | null;
  /** 作成日時(ISO 8601文字列)。 */
  created_at: string;
  /** 添付ファイル数。 */
  attachment_count: number;
}

/**
 * ドキュメント一覧取得エンドポイント。
 *
 * 公開中で有効期限内のドキュメント一覧を新着順でページネーション返却する。
 * クエリパラメーター `ids` にカンマ区切りでドキュメントID群が指定された場合は、該当ドキュメントのみを抽出する。
 */
documentsRouter.get('/', async (c) => {
  const pageParam = parseInt(c.req.query('page') || '1', 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  const limitParam = parseInt(c.req.query('limit') || '12', 10);
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, 50)
      : 12;

  const offset = (page - 1) * limit;

  const rawIds = c.req.query('ids');
  let targetIds: string[] = [];
  if (rawIds) {
    targetIds = rawIds
      .split(',')
      .map((id) => id.trim())
      .filter((id) => SLUG_PATTERN.test(id));

    if (targetIds.length === 0) {
      const emptyResponse: DocumentListResponse = {
        items: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
      };
      return c.json(emptyResponse, 200);
    }
  }

  const nowIso = new Date().toISOString();

  try {
    let whereClause =
      "d.status = 'published' AND (d.expires_at IS NULL OR d.expires_at > ?)";
    const queryParams: unknown[] = [nowIso];

    if (targetIds.length > 0) {
      const placeholders = targetIds.map(() => '?').join(', ');
      whereClause += ` AND d.id IN (${placeholders})`;
      queryParams.push(...targetIds);
    }

    const countQuery = `SELECT COUNT(*) AS total FROM documents d WHERE ${whereClause}`;
    const countStatement = c.env.DB.prepare(countQuery).bind(...queryParams);
    const countResult = await countStatement.first<{ total: number }>();
    const total = countResult?.total ?? 0;

    const listQuery = `
      SELECT
        d.id,
        d.title,
        d.description,
        d.expires_at,
        d.created_at,
        COUNT(a.id) AS attachment_count
      FROM documents d
      LEFT JOIN attachments a ON d.id = a.document_id
      WHERE ${whereClause}
      GROUP BY d.id
      ORDER BY d.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const listStatement = c.env.DB.prepare(listQuery).bind(
      ...queryParams,
      limit,
      offset,
    );
    const listResult = await listStatement.all<DocumentListRow>();
    const rows = listResult.results ?? [];

    const items: DocumentListItem[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description ?? null,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      attachmentCount: Number(row.attachment_count || 0),
    }));

    const totalPages = Math.ceil(total / limit);

    c.header('Cache-Control', 'public, max-age=10, s-maxage=30');

    const responsePayload: DocumentListResponse = {
      items,
      total,
      page,
      limit,
      totalPages,
    };

    return c.json(responsePayload, 200);
  } catch (error) {
    console.error('D1ドキュメント一覧取得エラー:', error);
    return c.json(
      {
        error: {
          message: 'ドキュメント一覧の取得に失敗しました。',
        },
      },
      500,
    );
  }
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

  // R2からのMarkdown本文実体取得(ローカル開発時S3フォールバック対応)。
  const r2Creds = {
    accountId: c.env.CLOUDFLARE_ACCOUNT_ID,
    accessKeyId: c.env.R2_ACCESS_KEY_ID,
    secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
    bucketName: c.env.R2_BUCKET_NAME,
  };

  let content = '';
  try {
    const text = await getR2Text(c.env.BUCKET, doc.content_r2_key, r2Creds);
    if (text === null) {
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
    content = text;
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
