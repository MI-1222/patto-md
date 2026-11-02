/** パーソナルアクセストークン(PAT)管理サブルーター。 */

import {
  createPatRequestSchema,
  formatMaskedPat,
  z,
  type CreatePatResponse,
  type DeletePatResponse,
  type TokenScope,
  type UserApiTokenItem,
  type UserApiTokenListResponse,
} from '@patto-md/shared';
import { Hono } from 'hono';
import {
  buildUserId,
  calculatePatExpiration,
  generatePat,
  hashPat,
} from '../lib/pat.ts';
import {
  authSessionMiddleware,
  requireAuthMiddleware,
} from '../middlewares/session.ts';
import type { AppEnv } from '../types.ts';

/**
 * PAT管理関連のサブルーター。
 *
 * 全エンドポイントでセッション検証を行い、ログイン中ユーザーのみアクセスを許可する。
 */
export const userTokensRouter = new Hono<AppEnv>();

userTokensRouter.use('*', authSessionMiddleware());
userTokensRouter.use('*', requireAuthMiddleware());

/** D1から取得するトークン一覧レコードの型定義。 */
interface D1UserApiTokenListRow {
  id: string;
  name: string;
  token_last4: string;
  scopes: string;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

/**
 * PAT 新規発行エンドポイント(`POST /api/user/tokens`)。
 *
 * ログイン中ユーザーに対して新しいパーソナルアクセストークンを発行し、D1 へ保存する。
 * 平文トークンは本レスポンスでのみ返却され、以降は二度と取得できない。
 */
userTokensRouter.post('/', async (c) => {
  const currentUser = c.get('user')!;
  const userId = buildUserId(currentUser.provider, currentUser.providerUserId);

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

  const parseResult = createPatRequestSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return c.json(
      {
        error: {
          message: 'リクエストパラメータの検証に失敗しました。',
          details: z.flattenError(parseResult.error),
        },
      },
      400,
    );
  }

  const { name, scopes, expiration } = parseResult.data;

  const plainToken = generatePat();
  let tokenHash: string;
  try {
    tokenHash = await hashPat(plainToken);
  } catch (error) {
    console.error('PAT のハッシュ計算に失敗しました。', error);
    return c.json(
      {
        error: {
          message: 'トークンの生成に失敗しました。',
        },
      },
      500,
    );
  }

  const tokenLast4 = plainToken.slice(-4);
  const expiresAt = calculatePatExpiration(expiration);
  const tokenId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const scopesJson = JSON.stringify(scopes);

  try {
    await c.env.DB.prepare(
      `INSERT INTO user_api_tokens (
        id,
        user_id,
        name,
        token_hash,
        token_last4,
        scopes,
        expires_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        tokenId,
        userId,
        name,
        tokenHash,
        tokenLast4,
        scopesJson,
        expiresAt,
        createdAt,
      )
      .run();
  } catch (error) {
    console.error('D1 への PAT 保存に失敗しました。', error);
    return c.json(
      {
        error: {
          message: 'トークンの保存に失敗しました。',
        },
      },
      500,
    );
  }

  const responsePayload: CreatePatResponse = {
    id: tokenId,
    name,
    token: plainToken,
    scopes,
    expiresAt,
    createdAt,
  };

  return c.json(responsePayload, 201);
});

/**
 * 発行済み PAT 一覧取得エンドポイント(`GET /api/user/tokens`)。
 *
 * ログイン中ユーザーが発行した PAT の一覧を取得する。
 * 平文および SHA-256 ハッシュは秘匿され、末尾4文字のみのマスク文字列として返却される。
 */
userTokensRouter.get('/', async (c) => {
  const currentUser = c.get('user')!;
  const userId = buildUserId(currentUser.provider, currentUser.providerUserId);

  let rows: D1UserApiTokenListRow[] = [];
  try {
    const result = await c.env.DB.prepare(
      `SELECT
        id,
        name,
        token_last4,
        scopes,
        expires_at,
        last_used_at,
        created_at
      FROM user_api_tokens
      WHERE user_id = ?
      ORDER BY created_at DESC`,
    )
      .bind(userId)
      .all<D1UserApiTokenListRow>();

    rows = result.results ?? [];
  } catch (error) {
    console.error('D1 からの PAT 一覧取得に失敗しました。', error);
    return c.json(
      {
        error: {
          message: 'トークン一覧の取得に失敗しました。',
        },
      },
      500,
    );
  }

  const tokens: UserApiTokenItem[] = rows.map((row) => {
    let parsedScopes: TokenScope[] = [];
    try {
      const parsed = JSON.parse(row.scopes);
      if (Array.isArray(parsed)) {
        parsedScopes = parsed as TokenScope[];
      }
    } catch {
      parsedScopes = [];
    }

    const tokenMasked = formatMaskedPat(row.token_last4);

    return {
      id: row.id,
      name: row.name,
      tokenMasked,
      scopes: parsedScopes,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
    };
  });

  const responsePayload: UserApiTokenListResponse = {
    tokens,
  };

  c.header('Cache-Control', 'private, no-cache, no-store');
  return c.json(responsePayload, 200);
});

/**
 * PAT 失効・削除エンドポイント(`DELETE /api/user/tokens/:id`)。
 *
 * 指定された ID の PAT を物理削除する。
 * IDOR 脆弱性防止のため、必ずログイン中ユーザーの `user_id` と一致するレコードのみを対象とし、
 * 存在しないか他人のトークンの場合は 404 を返却する。
 */
userTokensRouter.delete('/:id', async (c) => {
  const currentUser = c.get('user')!;
  const userId = buildUserId(currentUser.provider, currentUser.providerUserId);
  const id = c.req.param('id');

  if (!id || id.trim().length === 0) {
    return c.json(
      {
        error: {
          message: '無効なトークン識別子です。',
        },
      },
      400,
    );
  }

  try {
    const result = await c.env.DB.prepare(
      `DELETE FROM user_api_tokens
       WHERE id = ? AND user_id = ?`,
    )
      .bind(id, userId)
      .run();

    const changes = result.meta?.changes ?? 0;
    if (changes === 0) {
      return c.json(
        {
          error: {
            message: '指定されたトークンが見つかりません。',
          },
        },
        404,
      );
    }
  } catch (error) {
    console.error('D1 からの PAT 削除に失敗しました。', error);
    return c.json(
      {
        error: {
          message: 'トークンの削除に失敗しました。',
        },
      },
      500,
    );
  }

  c.header('Cache-Control', 'no-store');

  const responsePayload: DeletePatResponse = {
    success: true,
  };

  return c.json(responsePayload, 200);
});
