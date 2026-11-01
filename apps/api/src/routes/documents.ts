import {
  documentClaimRequestSchema,
  documentCommitRequestSchema,
  documentRenewRequestSchema,
  documentReportRequestSchema,
  documentUpdateRequestSchema,
  documentVerifyPasscodeRequestSchema,
  generateCapabilityToken,
  hashToken,
  RATE_LIMIT_DOCUMENT_CLAIM_LIMIT,
  RATE_LIMIT_DOCUMENT_CLAIM_WINDOW_SECONDS,
  RATE_LIMIT_DOCUMENT_COMMIT_LIMIT,
  RATE_LIMIT_DOCUMENT_COMMIT_WINDOW_SECONDS,
  RATE_LIMIT_DOCUMENT_DELETE_LIMIT,
  RATE_LIMIT_DOCUMENT_DELETE_WINDOW_SECONDS,
  RATE_LIMIT_DOCUMENT_RENEW_LIMIT,
  RATE_LIMIT_DOCUMENT_RENEW_WINDOW_SECONDS,
  RATE_LIMIT_DOCUMENT_REPORT_LIMIT,
  RATE_LIMIT_DOCUMENT_REPORT_WINDOW_SECONDS,
  RATE_LIMIT_DOCUMENT_UPDATE_LIMIT,
  RATE_LIMIT_DOCUMENT_UPDATE_WINDOW_SECONDS,
  RATE_LIMIT_VERIFY_PASSCODE_LIMIT,
  RATE_LIMIT_VERIFY_PASSCODE_WINDOW_SECONDS,
  verifyTokenHash,
  type AttachmentRecord,
  type DocumentClaimResponse,
  type DocumentCommitResponse,
  type DocumentDeleteResponse,
  type DocumentListItem,
  type DocumentListResponse,
  type DocumentRecord,
  type DocumentRenewResponse,
  type DocumentReportResponse,
  type DocumentResponse,
  type DocumentUpdateResponse,
  type DocumentVerifyPasscodeResponse,
  type DocumentVisibility,
  SLUG_PATTERN,
  z,
} from '@patto-md/shared';

import { Hono } from 'hono';
import { extractBearerToken } from '../lib/auth.ts';
import { calculateDocumentCacheControl } from '../lib/cache.ts';
import { calculateExpiresAt } from '../lib/date.ts';
import { hashPasscode, verifyPasscode } from '../lib/passcode.ts';
import {
  checkR2ObjectExists,
  copyAndDeleteR2Object,
  getExpirationPrefix,
  getR2Text,
  isValidR2Key,
  migrateR2KeyPrefix,
  resolveDocumentExpectedPrefix,
} from '../lib/r2.ts';
import { getClientIp } from '../lib/rate-limit.ts';
import { hashClientIp } from '../lib/ip-hash.ts';
import { generateSlug } from '../lib/slug.ts';
import {
  buildPasscodeSetCookieHeader,
  createViewToken,
  extractViewTokenFromCookie,
  resolveJwtSecret,
  verifyViewToken,
} from '../lib/view-token.ts';
import { createDocumentAuthMiddleware } from '../middlewares/auth.ts';
import { createRateLimitMiddleware } from '../middlewares/rate-limit.ts';
import { resolveSessionUser } from '../middlewares/session.ts';
import { createTurnstileMiddleware } from '../middlewares/turnstile.ts';
import type { AppEnv } from '../types.ts';

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
            details: z.flattenError(parseResult.error),
          },
        },
        400,
      );
    }

    const {
      title,
      description,
      contentR2Key,
      attachments,
      expiration,
      visibility = 'public',
      passcode,
    } = parseResult.data;

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

    /** 指定された有効期限プリセットに対応する期待プレフィックス。 */
    const expectedPrefix = getExpirationPrefix(expiration);
    if (
      !contentR2Key.startsWith(expectedPrefix) &&
      !contentR2Key.startsWith('temp/uploads/')
    ) {
      return c.json(
        {
          error: {
            message:
              'ドキュメントの有効期限と本文ストレージキーの失効プレフィックスが一致しません。',
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
      if (
        !attachment.r2Key.startsWith(expectedPrefix) &&
        !attachment.r2Key.startsWith('temp/uploads/')
      ) {
        return c.json(
          {
            error: {
              message: `添付ファイル「${attachment.fileName}」のストレージキーが有効期限プレフィックスと一致しません。`,
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

    let passcodeHash: string | null = null;
    if (visibility === 'protected' && passcode) {
      passcodeHash = await hashPasscode(passcode);
    }

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
        visibility,
        passcode_hash,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, 'published', ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        candidateSlug,
        title,
        description ?? null,
        contentR2Key,
        expiresAt,
        editTokenHash,
        modifyTokenHash,
        visibility,
        passcodeHash,
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
  /** ドキュメント公開範囲。 */
  visibility?: DocumentVisibility;
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
 * クエリパラメーター `mine=true` または `owner=me` が指定された場合は、ログイン中ユーザーが所有する全ドキュメントを抽出する。
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

  const isMine =
    c.req.query('mine') === 'true' || c.req.query('owner') === 'me';

  let currentUser = null;
  if (isMine) {
    currentUser = await resolveSessionUser(c);
    if (!currentUser) {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: {
            message: 'ログインが必要です。',
          },
        },
        401,
      );
    }
  }

  const rawIds = c.req.query('ids');
  let targetIds: string[] = [];
  if (!isMine && rawIds) {
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
    let whereClause: string;
    const queryParams: unknown[] = [];

    if (isMine && currentUser) {
      whereClause =
        "d.owner_user_id = ? AND d.owner_provider = ? AND d.status != 'deleted'";
      queryParams.push(currentUser.providerUserId, currentUser.provider);
    } else {
      whereClause =
        "d.status = 'published' AND (d.expires_at IS NULL OR d.expires_at > ?)";
      queryParams.push(nowIso);

      if (targetIds.length > 0) {
        const placeholders = targetIds.map(() => '?').join(', ');
        whereClause += ` AND d.id IN (${placeholders})`;
        queryParams.push(...targetIds);
      } else {
        whereClause += " AND d.visibility = 'public'";
      }
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
        d.visibility,
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
      visibility: row.visibility ?? 'public',
      createdAt: row.created_at,
      attachmentCount: Number(row.attachment_count || 0),
    }));

    const totalPages = Math.ceil(total / limit);

    if (isMine) {
      c.header('Cache-Control', 'private, no-cache, no-store');
    } else {
      c.header('Cache-Control', 'public, max-age=10, s-maxage=30');
    }

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
 * 指定された `Slug` に基づき、D1 からメタデータを取得してオンデマンドで有効期限を判定する。
 * パスコード保護ドキュメントの場合は特権トークンまたは閲覧認証トークンを検証し、未認可時は
 * 本文実体の取得を遮断して 401 を返却する。認可済みまたは全体公開ドキュメントであれば、
 * R2 から Markdown 本文実体を取得し、残存有効期限に応じた `Cache-Control` ヘッダーを付与して返却する。
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
        edit_token_hash,
        modify_token_hash,
        owner_user_id,
        owner_provider,
        visibility,
        passcode_hash,
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

  if (doc.visibility === 'protected') {
    let isAuthorized = false;

    const bearerToken = extractBearerToken(c.req.header('Authorization'));
    if (bearerToken) {
      const [isEditMatched, isModifyMatched] = await Promise.all([
        verifyTokenHash(bearerToken, doc.edit_token_hash),
        verifyTokenHash(bearerToken, doc.modify_token_hash),
      ]);
      if (isEditMatched || isModifyMatched) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      const secret = resolveJwtSecret(c.env);
      const cookieHeader = c.req.header('Cookie');
      const cookieToken = extractViewTokenFromCookie(cookieHeader, doc.id);
      if (cookieToken && (await verifyViewToken(cookieToken, doc.id, secret))) {
        isAuthorized = true;
      } else if (
        bearerToken &&
        (await verifyViewToken(bearerToken, doc.id, secret))
      ) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized && doc.owner_user_id && doc.owner_provider) {
      const currentUser = await resolveSessionUser(c);
      if (
        currentUser &&
        currentUser.providerUserId === doc.owner_user_id &&
        currentUser.provider === doc.owner_provider
      ) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      c.header('Cache-Control', 'private, no-cache, no-store');
      return c.json(
        {
          error: {
            message: 'このドキュメントはパスコードで保護されています。',
          },
          document: {
            id: doc.id,
            title: doc.title,
            content: '',
            visibility: doc.visibility,
            isProtected: true,
            status: doc.status,
            ownerUserId: doc.owner_user_id,
            ownerProvider: doc.owner_provider,
            expiresAt: doc.expires_at,
            createdAt: doc.created_at,
            updatedAt: doc.updated_at,
            attachments: [],
          },
        },
        401,
      );
    }
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
  // パスコード保護ドキュメントの場合はエッジキャッシュ汚染防止のため常に private, no-store を強制する。
  if (doc.visibility === 'protected') {
    c.header('Cache-Control', 'private, no-cache, no-store');
  } else {
    const cacheControl = calculateDocumentCacheControl(doc.expires_at, now);
    c.header('Cache-Control', cacheControl);
  }

  // レスポンスの構築(スネークケースからキャメルケースへの変換)。
  const responsePayload: DocumentResponse = {
    id: doc.id,
    title: doc.title,
    content,
    visibility: doc.visibility,
    isProtected: false,
    status: doc.status,
    ownerUserId: doc.owner_user_id,
    ownerProvider: doc.owner_provider,
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

/**
 * ドキュメント本文およびメタデータの更新エンドポイント(`PUT /api/documents/:id`)。
 *
 * `modify` または `edit` のケイパビリティトークン保持者のみ実行可能。
 * 本文用 R2 キーおよび添付アセットの実体存在を確認した上で、公開範囲(`visibility`)や
 * パスコード(`passcode`)の設定更新、D1 の `documents` レコード更新、および `attachments` レコード群の入れ替えをアトミックに実行する。
 * 更新完了後は `Cache-Control: no-store` を返却する。
 */
documentsRouter.put(
  '/:id',
  createRateLimitMiddleware({
    action: 'document-update',
    limit: RATE_LIMIT_DOCUMENT_UPDATE_LIMIT,
    windowSeconds: RATE_LIMIT_DOCUMENT_UPDATE_WINDOW_SECONDS,
  }),
  createDocumentAuthMiddleware('modify'),
  async (c) => {
    const authDoc = c.get('authDoc')!;
    const id = authDoc.id;

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

    const parsed = documentUpdateRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            message: 'リクエストパラメータの検証に失敗しました。',
            details: z.flattenError(parsed.error),
          },
        },
        400,
      );
    }

    const {
      title,
      description,
      contentR2Key,
      attachments,
      visibility,
      passcode,
    } = parsed.data;

    if (!isValidR2Key(contentR2Key)) {
      return c.json(
        {
          error: {
            message: '無効な本文R2オブジェクトキーです。',
          },
        },
        400,
      );
    }

    /** 既存ドキュメントの失効設定から期待されるR2プレフィックス。 */
    const expectedPrefix = resolveDocumentExpectedPrefix(authDoc);

    if (
      !contentR2Key.startsWith(expectedPrefix) &&
      !contentR2Key.startsWith('temp/uploads/')
    ) {
      return c.json(
        {
          error: {
            message:
              '既存ドキュメントの有効期限プレフィックスと本文ストレージキーが一致しません。',
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
              message: `無効な添付ファイルR2オブジェクトキーです: ${attachment.fileName}`,
            },
          },
          400,
        );
      }
      if (
        !attachment.r2Key.startsWith(expectedPrefix) &&
        !attachment.r2Key.startsWith('temp/uploads/')
      ) {
        return c.json(
          {
            error: {
              message: `添付ファイル「${attachment.fileName}」のストレージキーが有効期限プレフィックスと一致しません。`,
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

    const contentExists = await checkR2ObjectExists(
      c.env.BUCKET,
      contentR2Key,
      r2Creds,
    );
    if (!contentExists) {
      return c.json(
        {
          error: {
            message: '指定された本文ファイルがストレージに存在しません。',
          },
        },
        400,
      );
    }

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
              message: `指定された添付ファイルがストレージに存在しません: ${missingAttachment.fileName}`,
            },
          },
          400,
        );
      }
    }

    const finalVisibility = visibility ?? authDoc.visibility;
    let finalPasscodeHash = authDoc.passcode_hash;

    if (visibility !== undefined) {
      if (finalVisibility === 'protected') {
        if (passcode && passcode.trim().length > 0) {
          finalPasscodeHash = await hashPasscode(passcode.trim());
        } else if (!finalPasscodeHash) {
          return c.json(
            {
              error: {
                message:
                  'パスコード保護設定時は4〜32文字のパスコードが必須です。',
              },
            },
            400,
          );
        }
      } else {
        finalPasscodeHash = null;
      }
    } else if (passcode && passcode.trim().length > 0) {
      if (finalVisibility === 'protected') {
        finalPasscodeHash = await hashPasscode(passcode.trim());
      }
    }

    const updatedAt = new Date().toISOString();

    const documentStatement = c.env.DB.prepare(
      `UPDATE documents
      SET title = ?,
          description = ?,
          content_r2_key = ?,
          visibility = ?,
          passcode_hash = ?,
          updated_at = ?
      WHERE id = ?`,
    ).bind(
      title,
      description ?? null,
      contentR2Key,
      finalVisibility,
      finalPasscodeHash,
      updatedAt,
      id,
    );

    const deleteAttachmentsStatement = c.env.DB.prepare(
      `DELETE FROM attachments WHERE document_id = ?`,
    ).bind(id);

    const insertAttachmentStatements = attachments.map((att) => {
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
        att.id,
        id,
        att.fileName,
        att.fileSize,
        att.mimeType,
        att.r2Key,
        updatedAt,
      );
    });

    try {
      await c.env.DB.batch([
        documentStatement,
        deleteAttachmentsStatement,
        ...insertAttachmentStatements,
      ]);
    } catch (error) {
      console.error('D1ドキュメント更新エラー:', error);
      return c.json(
        {
          error: {
            message: 'データベースの更新に失敗しました。',
          },
        },
        500,
      );
    }

    c.header('Cache-Control', 'no-store');

    const responsePayload: DocumentUpdateResponse = {
      id,
      url: `/p/${id}`,
      title,
      visibility: finalVisibility,
      description: description ?? null,
      expiresAt: authDoc.expires_at,
      createdAt: authDoc.created_at,
      updatedAt,
    };

    return c.json(responsePayload, 200);
  },
);

/**
 * ドキュメント削除エンドポイント(`DELETE /api/documents/:id`)。
 *
 * 特権 `edit` トークン保持者のみ実行可能。
 * 対象レコードを `status = 'deleted'` に更新する論理削除を行い、以降の閲覧・更新を遮断する。
 */
documentsRouter.delete(
  '/:id',
  createRateLimitMiddleware({
    action: 'document-delete',
    limit: RATE_LIMIT_DOCUMENT_DELETE_LIMIT,
    windowSeconds: RATE_LIMIT_DOCUMENT_DELETE_WINDOW_SECONDS,
  }),
  createDocumentAuthMiddleware('edit'),
  async (c) => {
    const authDoc = c.get('authDoc')!;
    const id = authDoc.id;
    const updatedAt = new Date().toISOString();

    try {
      await c.env.DB.prepare(
        `UPDATE documents
        SET status = 'deleted',
            updated_at = ?
        WHERE id = ?`,
      )
        .bind(updatedAt, id)
        .run();
    } catch (error) {
      console.error('D1ドキュメント削除エラー:', error);
      return c.json(
        {
          error: {
            message: 'データベースの更新に失敗しました。',
          },
        },
        500,
      );
    }

    c.header('Cache-Control', 'no-store');

    const responsePayload: DocumentDeleteResponse = {
      success: true,
      id,
    };

    return c.json(responsePayload, 200);
  },
);

/**
 * ドキュメント再公開および有効期限延長エンドポイント(`POST /api/documents/:id/renew`)。
 *
 * 特権 `edit` トークン保持者のみ実行可能。
 * 現在時刻を起点に指定プリセットから有効期限を再計算し、`status = 'published'` に復帰させる。
 * R2 上の Markdown 本文および添付アセットを新有効期限プレフィックスへ再配置して起算日(Creation Time)を更新し、
 * 本文中の画像参照 URL (`/api/assets/...`) を新キーへ一括置換した上で、D1 のドキュメント情報および添付キーをアトミックに更新する。
 */
documentsRouter.post(
  '/:id/renew',
  createRateLimitMiddleware({
    action: 'document-renew',
    limit: RATE_LIMIT_DOCUMENT_RENEW_LIMIT,
    windowSeconds: RATE_LIMIT_DOCUMENT_RENEW_WINDOW_SECONDS,
  }),
  createDocumentAuthMiddleware('edit'),
  async (c) => {
    const authDoc = c.get('authDoc')!;
    const id = authDoc.id;

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

    const parsed = documentRenewRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            message: 'リクエストパラメータの検証に失敗しました。',
            details: z.flattenError(parsed.error),
          },
        },
        400,
      );
    }

    const { expiration } = parsed.data;
    const now = new Date();
    const newExpiresAt = calculateExpiresAt(expiration, now);
    const updatedAt = now.toISOString();

    /** 延長後の有効期限プリセットに対応する新プレフィックス。 */
    const newPrefix = getExpirationPrefix(expiration);
    const oldContentKey = authDoc.content_r2_key;
    /** 新プレフィックスを付与した本文の R2 オブジェクトキー。 */
    const newContentKey = migrateR2KeyPrefix(oldContentKey, newPrefix);

    const r2Creds = {
      accountId: c.env.CLOUDFLARE_ACCOUNT_ID,
      accessKeyId: c.env.R2_ACCESS_KEY_ID,
      secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
      bucketName: c.env.R2_BUCKET_NAME,
    };

    try {
      /** 置換対象となる Markdown 本文テキスト。 */
      let updatedContentText: string | null = null;
      if (c.env.BUCKET && typeof c.env.BUCKET.get === 'function') {
        updatedContentText = await getR2Text(
          c.env.BUCKET,
          oldContentKey,
          r2Creds,
        );
      }

      const preparedAttachments = c.env.DB.prepare(
        'SELECT id, r2_key FROM attachments WHERE document_id = ?',
      ).bind(id);

      const attachmentsResult =
        typeof preparedAttachments.all === 'function'
          ? await preparedAttachments.all<{ id: string; r2_key: string }>()
          : { results: [] };

      /** 添付ファイルの新キー移行情報一覧。 */
      const attachmentMigrations: Array<{ id: string; newR2Key: string }> = [];
      /** 並列実行する R2 オブジェクト操作タスク一覧。 */
      const r2Operations: Promise<unknown>[] = [];

      if (attachmentsResult?.results && attachmentsResult.results.length > 0) {
        for (const att of attachmentsResult.results) {
          const newAttKey = migrateR2KeyPrefix(att.r2_key, newPrefix);
          if (c.env.BUCKET && typeof c.env.BUCKET.get === 'function') {
            r2Operations.push(
              copyAndDeleteR2Object(c.env.BUCKET, att.r2_key, newAttKey),
            );
          }

          if (updatedContentText && att.r2_key !== newAttKey) {
            updatedContentText = updatedContentText
              .replaceAll(
                `/api/assets/${att.r2_key}`,
                `/api/assets/${newAttKey}`,
              )
              .replaceAll(
                `/api/assets/${encodeURI(att.r2_key)}`,
                `/api/assets/${encodeURI(newAttKey)}`,
              );
          }

          attachmentMigrations.push({ id: att.id, newR2Key: newAttKey });
        }
      }

      if (c.env.BUCKET && typeof c.env.BUCKET.put === 'function') {
        if (updatedContentText !== null) {
          r2Operations.push(
            (async () => {
              await c.env.BUCKET.put(newContentKey, updatedContentText, {
                httpMetadata: {
                  contentType: 'text/markdown; charset=utf-8',
                },
              });
              if (
                oldContentKey !== newContentKey &&
                typeof c.env.BUCKET.delete === 'function'
              ) {
                await c.env.BUCKET.delete(oldContentKey);
              }
            })(),
          );
        } else if (typeof c.env.BUCKET.get === 'function') {
          r2Operations.push(
            copyAndDeleteR2Object(c.env.BUCKET, oldContentKey, newContentKey),
          );
        }
      }

      if (r2Operations.length > 0) {
        await Promise.all(r2Operations);
      }

      if (attachmentMigrations.length > 0) {
        const statements: D1PreparedStatement[] = [
          c.env.DB.prepare(
            `UPDATE documents
            SET expires_at = ?,
                status = 'published',
                updated_at = ?,
                content_r2_key = ?
            WHERE id = ?`,
          ).bind(newExpiresAt, updatedAt, newContentKey, id),
        ];

        for (const migration of attachmentMigrations) {
          statements.push(
            c.env.DB.prepare(
              'UPDATE attachments SET r2_key = ? WHERE id = ?',
            ).bind(migration.newR2Key, migration.id),
          );
        }

        await c.env.DB.batch(statements);
      } else {
        await c.env.DB.prepare(
          `UPDATE documents
          SET expires_at = ?,
              status = 'published',
              updated_at = ?,
              content_r2_key = ?
          WHERE id = ?`,
        )
          .bind(newExpiresAt, updatedAt, newContentKey, id)
          .run();
      }
    } catch (error) {
      console.error('ドキュメント有効期限延長・ストレージ移行エラー:', error);
      return c.json(
        {
          error: {
            message: 'データベースまたはストレージの更新に失敗しました。',
          },
        },
        500,
      );
    }

    c.header('Cache-Control', 'no-store');

    const responsePayload: DocumentRenewResponse = {
      id,
      url: `/p/${id}`,
      expiresAt: newExpiresAt,
      updatedAt,
    };

    return c.json(responsePayload, 200);
  },
);

/**
 * パスコード照合エンドポイント(`POST /api/documents/:id/verify-passcode`)。
 *
 * 入力されたパスコードを保存済み `PBKDF2` ハッシュと定数時間比較で照合し、
 * 成功時に短期署名付き閲覧 `Cookie`(`JWT`) およびトークンを返却する。
 * ブルートフォース攻撃防止のため、IP とドキュメントID単位で厳格なレートリミットを適用する。
 */
documentsRouter.post(
  '/:id/verify-passcode',
  createRateLimitMiddleware({
    action: 'verify-passcode',
    limit: RATE_LIMIT_VERIFY_PASSCODE_LIMIT,
    windowSeconds: RATE_LIMIT_VERIFY_PASSCODE_WINDOW_SECONDS,
    keyGenerator: (c) => {
      const ip =
        c.req.header('cf-connecting-ip') ||
        c.req.header('x-forwarded-for') ||
        'anonymous';
      const id = c.req.param('id') || 'unknown';
      return `verify-passcode:${ip}:${id}`;
    },
  }),
  async (c) => {
    const id = c.req.param('id');
    if (!id || !SLUG_PATTERN.test(id)) {
      return c.json(
        {
          error: {
            message: '無効なドキュメント識別子です。',
          },
        },
        400,
      );
    }

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

    const parseResult = documentVerifyPasscodeRequestSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return c.json(
        {
          error: {
            message: 'パスコードが入力されていません。',
            details: z.flattenError(parseResult.error),
          },
        },
        400,
      );
    }

    const { passcode } = parseResult.data;
    const nowIso = new Date().toISOString();

    let doc: Pick<
      DocumentRecord,
      'id' | 'status' | 'expires_at' | 'visibility' | 'passcode_hash'
    > | null = null;
    try {
      doc = await c.env.DB.prepare(
        `SELECT id, status, expires_at, visibility, passcode_hash
         FROM documents
         WHERE id = ?
         LIMIT 1`,
      )
        .bind(id)
        .first<
          Pick<
            DocumentRecord,
            'id' | 'status' | 'expires_at' | 'visibility' | 'passcode_hash'
          >
        >();
    } catch (error) {
      console.error('D1パスコード照合クエリエラー:', error);
      return c.json(
        {
          error: {
            message: 'データベースの参照に失敗しました。',
          },
        },
        500,
      );
    }

    if (!doc || doc.status === 'deleted') {
      return c.json(
        {
          error: {
            message: 'ドキュメントが見つかりません。',
          },
        },
        404,
      );
    }

    if (doc.status === 'suspended') {
      return c.json(
        {
          error: {
            message: '規約違反の通報により凍結されています。',
          },
        },
        403,
      );
    }

    if (doc.expires_at && doc.expires_at <= nowIso) {
      return c.json(
        {
          error: {
            message: 'ドキュメントが見つかりません。',
          },
        },
        404,
      );
    }

    if (doc.visibility !== 'protected' || !doc.passcode_hash) {
      return c.json(
        {
          error: {
            message: 'このドキュメントはパスコードで保護されていません。',
          },
        },
        400,
      );
    }

    const isMatched = await verifyPasscode(passcode, doc.passcode_hash);
    if (!isMatched) {
      return c.json(
        {
          error: {
            message: 'パスコードが一致しません。',
          },
        },
        401,
      );
    }

    const secret = resolveJwtSecret(c.env);
    const { token, expiresAt } = await createViewToken(doc.id, secret);

    c.header('Set-Cookie', buildPasscodeSetCookieHeader(doc.id, token));
    c.header('Cache-Control', 'no-store');

    const responsePayload: DocumentVerifyPasscodeResponse = {
      success: true,
      token,
      expiresAt,
    };

    return c.json(responsePayload, 200);
  },
);

/**
 * 匿名ドキュメント所有権移譲(`POST /api/documents/:id/claim`)エンドポイント。
 *
 * ログイン中ユーザーが特権管理トークン(`editToken`)を提示し、ドキュメントの所有権を自アカウントへ紐付ける。
 *
 * 処理手順:
 * 1. セッション検証: 未ログイン時は 401 を返却する。
 * 2. 識別子検証: `id` の形式が不正な場合は 400 を返却する。
 * 3. 管理トークン抽出: リクエスト本文または `Authorization` ヘッダーから `editToken` を抽出する。
 * 4. ドキュメント参照: 対象が存在しない・論理削除済みの場合は 404、凍結中は 403 を返却する。
 * 5. トークン照合: `edit_token_hash` に対する定数時間照合を行い、権限のないトークン(`modifyToken` 等)を遮断する。
 * 6. 所有者競合検証: 既に他者が所有している場合は 409 Conflict、同一ユーザーが再実行した場合は冪等に 200 OK を返却する。
 * 7. 条件付きアトミック更新: D1 データベース内のレコードを更新し、所有権を確定する。
 *
 * 1分あたり最大5リクエストのレートリミットを適用する。
 */
documentsRouter.post(
  '/:id/claim',
  createRateLimitMiddleware({
    action: 'document-claim',
    limit: RATE_LIMIT_DOCUMENT_CLAIM_LIMIT,
    windowSeconds: RATE_LIMIT_DOCUMENT_CLAIM_WINDOW_SECONDS,
  }),
  async (c) => {
    const currentUser = await resolveSessionUser(c);

    if (!currentUser) {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: {
            message: 'ドキュメントの所有権を移譲するにはログインが必要です。',
          },
        },
        401,
      );
    }

    const id = c.req.param('id');
    if (!id || !SLUG_PATTERN.test(id)) {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: {
            message: '無効なドキュメント識別子です。',
          },
        },
        400,
      );
    }

    let editToken: string | null = null;
    try {
      const rawBody = await c.req.json();
      const parseResult = documentClaimRequestSchema.safeParse(rawBody);
      if (parseResult.success) {
        editToken = parseResult.data.editToken;
      }
    } catch {
      // JSON形式不正時はフォールバックとして Authorization ヘッダーを照合。
    }

    if (!editToken) {
      const authHeader = c.req.header('Authorization');
      const bearer = extractBearerToken(authHeader);
      if (bearer) {
        const parseResult = documentClaimRequestSchema.safeParse({
          editToken: bearer,
        });
        if (parseResult.success) {
          editToken = parseResult.data.editToken;
        }
      }
    }

    if (!editToken) {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: {
            message: '有効な特権管理トークン(editToken)が指定されていません。',
          },
        },
        400,
      );
    }

    let doc: Pick<
      DocumentRecord,
      | 'id'
      | 'status'
      | 'expires_at'
      | 'edit_token_hash'
      | 'owner_user_id'
      | 'owner_provider'
    > | null = null;

    try {
      doc = await c.env.DB.prepare(
        `SELECT
          id,
          status,
          expires_at,
          edit_token_hash,
          owner_user_id,
          owner_provider
        FROM documents
        WHERE id = ?
        LIMIT 1`,
      )
        .bind(id)
        .first();
    } catch (error) {
      console.error('D1ドキュメントClaim参照エラー:', error);
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: {
            message: 'データベースの参照に失敗しました。',
          },
        },
        500,
      );
    }

    if (!doc || doc.status === 'deleted') {
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

    if (doc.status === 'suspended') {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: {
            message: '規約違反の通報により凍結されています。',
          },
        },
        403,
      );
    }

    const isEditMatched = await verifyTokenHash(editToken, doc.edit_token_hash);
    if (!isEditMatched) {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: {
            message: '操作を行う権限がありません。',
          },
        },
        403,
      );
    }

    if (
      doc.owner_user_id &&
      (doc.owner_user_id !== currentUser.providerUserId ||
        doc.owner_provider !== currentUser.provider)
    ) {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: {
            message: 'このドキュメントは既に別のアカウントに所有されています。',
          },
        },
        409,
      );
    }

    const nowIso = new Date().toISOString();

    if (
      doc.owner_user_id === currentUser.providerUserId &&
      doc.owner_provider === currentUser.provider
    ) {
      c.header('Cache-Control', 'no-store');
      const responsePayload: DocumentClaimResponse = {
        success: true,
        id: doc.id,
        ownerUserId: currentUser.providerUserId,
        ownerProvider: currentUser.provider,
        updatedAt: nowIso,
      };
      return c.json(responsePayload, 200);
    }

    try {
      const updateResult = await c.env.DB.prepare(
        `UPDATE documents
        SET owner_user_id = ?,
            owner_provider = ?,
            updated_at = ?
        WHERE id = ?
          AND status != 'deleted'
          AND status != 'suspended'
          AND (owner_user_id IS NULL OR (owner_user_id = ? AND owner_provider = ?))`,
      )
        .bind(
          currentUser.providerUserId,
          currentUser.provider,
          nowIso,
          doc.id,
          currentUser.providerUserId,
          currentUser.provider,
        )
        .run();

      const changes = updateResult.meta?.changes ?? 0;
      if (changes === 0) {
        c.header('Cache-Control', 'no-store');
        return c.json(
          {
            error: {
              message:
                'このドキュメントは既に別のアカウントに所有されています。',
            },
          },
          409,
        );
      }
    } catch (error) {
      console.error('D1ドキュメントClaim更新エラー:', error);
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: {
            message: '所有権の移譲処理に失敗しました。',
          },
        },
        500,
      );
    }

    c.header('Cache-Control', 'no-store');
    const responsePayload: DocumentClaimResponse = {
      success: true,
      id: doc.id,
      ownerUserId: currentUser.providerUserId,
      ownerProvider: currentUser.provider,
      updatedAt: nowIso,
    };
    return c.json(responsePayload, 200);
  },
);

/**
 * ドキュメント通報受付エンドポイント。
 *
 * 閲覧者からのスパム・規約違反等の通報を受け付け、D1 `abuse_reports` テーブルに記録する。
 * ボットによるスクリプト通報を防ぐため Turnstile 検証を必須とし、
 * エッジレートリミット(1分間3回)およびIPアドレスのソルト付き不可逆ハッシュ化により
 * プライバシー保護とDoS攻撃耐性を両立する。
 * 同一IPからの多重通報は水増しを防ぐため再登録せず冪等に受付完了を返却する。
 */
documentsRouter.post(
  '/:id/report',
  createRateLimitMiddleware({
    limit: RATE_LIMIT_DOCUMENT_REPORT_LIMIT,
    windowSeconds: RATE_LIMIT_DOCUMENT_REPORT_WINDOW_SECONDS,
    action: 'document-report',
  }),
  createTurnstileMiddleware({ required: true }),
  async (c) => {
    const id = c.req.param('id');

    // Slug形式の事前検証。
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

    // リクエストボディのパース。
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: {
            message: 'リクエストボディが不正なJSON形式です。',
          },
        },
        400,
      );
    }

    // Zodスキーマによる入力検証。
    const parseResult = documentReportRequestSchema.safeParse(rawBody);
    if (!parseResult.success) {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: {
            message: '入力内容に誤りがあります。',
            details: parseResult.error.flatten(),
          },
        },
        400,
      );
    }

    const { reason, details } = parseResult.data;

    // 対象ドキュメントの存在確認。
    let doc: { id: string; status: string } | null = null;
    try {
      doc = await c.env.DB.prepare(
        `SELECT id, status FROM documents WHERE id = ? LIMIT 1`,
      )
        .bind(id)
        .first<{ id: string; status: string }>();
    } catch (error) {
      console.error('D1ドキュメント存在確認クエリエラー:', error);
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: {
            message: 'データベースの参照に失敗しました。',
          },
        },
        500,
      );
    }

    if (!doc || doc.status === 'deleted') {
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

    // 既に凍結済みの場合は不要な書き込みを避け、200 OKを返却する。
    if (doc.status === 'suspended') {
      c.header('Cache-Control', 'no-store');
      const responsePayload: DocumentReportResponse = {
        success: true,
        message: '通報を受け付けました。',
      };
      return c.json(responsePayload, 200);
    }

    // クライアントIPのペッパー付きSHA-256ハッシュ化。
    const clientIp = getClientIp(c);
    const jwtSecret = resolveJwtSecret(c.env);
    const reporterIpHash = await hashClientIp(clientIp, jwtSecret);

    // 通報レコードの登録(複合ユニーク制約により同一IPの重複通報は INSERT OR IGNORE で自動スキップ)。
    try {
      const reasonText =
        details && details.trim().length > 0
          ? `${reason}: ${details.trim()}`
          : reason;
      const nowIso = new Date().toISOString();

      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO abuse_reports (
          document_id,
          reporter_ip_hash,
          reason,
          created_at
        ) VALUES (?, ?, ?, ?)`,
      )
        .bind(id, reporterIpHash, reasonText, nowIso)
        .run();
    } catch (error) {
      console.error('D1通報登録エラー:', error);
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: {
            message: '通報の処理に失敗しました。',
          },
        },
        500,
      );
    }

    c.header('Cache-Control', 'no-store');
    const responsePayload: DocumentReportResponse = {
      success: true,
      message: '通報を受け付けました。',
    };
    return c.json(responsePayload, 200);
  },
);
