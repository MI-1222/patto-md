/** ケイパビリティトークンおよびOAuthセッションによるドキュメント認可処理およびミドルウェア。 */

import type { MiddlewareHandler } from 'hono';
import {
  CAPABILITY_TOKEN_PATTERN,
  SLUG_PATTERN,
  verifyTokenHash,
  type CapabilityTokenType,
} from '@patto-md/shared';
import { resolveSessionUser } from '../middlewares/session.ts';
import type { AppEnv, AuthenticatedDocument } from '../types.ts';

/**
 * `Authorization` ヘッダー文字列から `Bearer` トークンを抽出する。
 *
 * @param authHeader - `Authorization` ヘッダー値。
 * @returns 抽出されたトークン文字列。存在しないまたは形式不正時は `null`。
 */
export function extractBearerToken(authHeader?: string | null): string | null {
  if (!authHeader) {
    return null;
  }
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) {
    return null;
  }
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

/**
 * ドキュメント操作に必要な権限を検証する Hono ミドルウェアを生成する。
 *
 * `Authorization: Bearer <token>` ヘッダー、またはログイン中 OAuth セッションによる所有者照合を行い、
 * D1 データベース内のレコードと照合して認可を判定する。
 *
 * 対象レコードが存在しない場合や論理削除済み(`status = 'deleted'`)の場合は 404、
 * 規約違反通報により凍結済み(`status = 'suspended'`)の場合は 403 を返却して処理を遮断する。
 *
 * 特権トークン(`edit`)およびドキュメント所有者セッションはすべての操作を認可し、
 * 更新トークン(`modify`)は本文更新権限要求時のみ認可する。
 * 認可成功時はコンテキスト変数へ `authDoc` と `tokenRole` を格納する。
 *
 * @param requiredRole - 必要な最小権限ロール(`edit`: 特権操作 / `modify`: 本文更新)。
 * @returns Hono ミドルウェアハンドラー。
 */
export function createDocumentAuthMiddleware(
  requiredRole: CapabilityTokenType,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.req.method === 'OPTIONS') {
      return next();
    }

    const authHeader = c.req.header('Authorization');
    const token = extractBearerToken(authHeader);

    if (token && !CAPABILITY_TOKEN_PATTERN.test(token)) {
      return c.json(
        {
          error: {
            message: '無効な認証トークン形式です。',
          },
        },
        401,
      );
    }

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

    const currentUser = !token ? await resolveSessionUser(c) : null;
    if (!token && !currentUser) {
      return c.json(
        {
          error: {
            message: '認証トークンが指定されていません。',
          },
        },
        401,
      );
    }

    let doc: AuthenticatedDocument | null = null;
    try {
      doc = await c.env.DB.prepare(
        `SELECT
          id,
          title,
          description,
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
        LIMIT 1`,
      )
        .bind(id)
        .first<AuthenticatedDocument>();
    } catch (error) {
      console.error('D1ドキュメント認証クエリエラー:', error);
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

    let matchedRole: CapabilityTokenType | null = null;

    if (token) {
      const isEditMatched = await verifyTokenHash(token, doc.edit_token_hash);
      if (isEditMatched) {
        matchedRole = 'edit';
      } else if (requiredRole === 'modify') {
        const isModifyMatched = await verifyTokenHash(
          token,
          doc.modify_token_hash,
        );
        if (isModifyMatched) {
          matchedRole = 'modify';
        }
      }
    }

    if (!matchedRole && doc.owner_user_id && doc.owner_provider) {
      const sessionUser = currentUser ?? (await resolveSessionUser(c));
      if (
        sessionUser &&
        sessionUser.providerUserId === doc.owner_user_id &&
        sessionUser.provider === doc.owner_provider
      ) {
        matchedRole = 'edit';
      }
    }

    if (!matchedRole) {
      if (!token) {
        return c.json(
          {
            error: {
              message: '認証トークンが指定されていません。',
            },
          },
          401,
        );
      }
      return c.json(
        {
          error: {
            message: '操作を行う権限がありません。',
          },
        },
        403,
      );
    }

    c.set('authDoc', doc);
    c.set('tokenRole', matchedRole);

    return next();
  };
}
