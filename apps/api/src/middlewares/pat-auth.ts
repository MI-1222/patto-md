/** パーソナルアクセストークン(PAT)認可ミドルウェアおよびスコープ検証。 */

import type { TokenScope } from '@patto-md/shared';
import type { Context, MiddlewareHandler } from 'hono';
import { extractBearerToken } from '../lib/auth.ts';
import {
  isPat,
  parseUserId,
  safelyGetExecutionCtx,
  verifyAndResolvePat,
} from '../lib/pat.ts';
import { createTurnstileMiddleware } from './turnstile.ts';
import type { AppEnv, PatAuthContext } from '../types.ts';

/**
 * Hono コンテキストから PAT 認可情報を解決・取得する。
 *
 * コンテキストキャッシュ(`c.get('patUser')`)が存在する場合はそれを優先する。
 * 未解決の場合は `Authorization: Bearer <token>` を抽出し、`isPat(token)` で形式検証した上で
 * D1 の `user_api_tokens` テーブルをハッシュ値で照合する。
 *
 * トークンが存在しない、形式が不正、DBに存在しない、または有効期限切れの場合は `null` を返却する。
 * 認可成功時はコンテキスト変数 `patUser` および互換用 `user` を設定する。
 *
 * @param c - Hono コンテキスト。
 * @returns 解決された PAT 認可情報。未認可または無効時は `null`。
 */
export async function resolvePatAuth(
  c: Context<AppEnv>,
): Promise<PatAuthContext | null> {
  const cached = c.get('patUser');
  if (cached !== undefined) {
    return cached;
  }

  const authHeader = c.req.header('Authorization');
  const token = extractBearerToken(authHeader);

  if (!token || !isPat(token)) {
    c.set('patUser', null);
    return null;
  }

  const patUser = await verifyAndResolvePat({
    db: c.env.DB,
    token,
    executionCtx: safelyGetExecutionCtx(c),
  });

  c.set('patUser', patUser);

  if (patUser && !c.get('user')) {
    const parsedUser = parseUserId(patUser.userId);
    if (parsedUser) {
      c.set('user', {
        provider: parsedUser.provider,
        providerUserId: parsedUser.providerUserId,
        username: patUser.name,
        avatarUrl: null,
      });
    }
  }

  return patUser;
}

/** PAT認可ミドルウェアのオプション設定。 */
export interface PatAuthMiddlewareOptions {
  /**
   * トークンの提供を必須とするかどうか。
   * 既定値は `true`。`false` の場合、トークンがヘッダーに存在するときのみ検証を行う。
   */
  required?: boolean;

  /** 要求される最小限の認可スコープ。 */
  scope?: TokenScope;
}

/**
 * パーソナルアクセストークン(PAT)による API 認可を行う Hono ミドルウェアを生成する。
 *
 * リクエストヘッダー `Authorization: Bearer pmd_pat_...` を検知・検証し、
 * 正当な PAT であることおよび要求スコープを保有しているかを判定する。
 *
 * @param options - ミドルウェアの挙動オプション。
 * @returns Hono ミドルウェアハンドラー。
 */
export function createPatAuthMiddleware(
  options: PatAuthMiddlewareOptions = {},
): MiddlewareHandler<AppEnv> {
  const { required = true, scope } = options;

  return async (c, next) => {
    if (c.req.method === 'OPTIONS') {
      return next();
    }

    const authHeader = c.req.header('Authorization');
    const token = extractBearerToken(authHeader);

    if (!token) {
      if (required) {
        return c.json(
          {
            error: {
              message: 'PATトークンが指定されていません。',
            },
          },
          401,
        );
      }
      return next();
    }

    if (!isPat(token)) {
      return c.json(
        {
          error: {
            message: '無効な認証トークン形式です。',
          },
        },
        401,
      );
    }

    const patUser = await resolvePatAuth(c);
    if (!patUser) {
      return c.json(
        {
          error: {
            message: '無効または有効期限切れのPATトークンです。',
          },
        },
        401,
      );
    }

    if (scope && !patUser.scopes.includes(scope)) {
      return c.json(
        {
          error: {
            message: `操作に必要な権限(スコープ: ${scope})がありません。`,
          },
        },
        403,
      );
    }

    return next();
  };
}

/**
 * 特定の認可スコープを必須とする PAT ガードミドルウェア。
 *
 * @param requiredScope - 要求するスコープ名(`documents:read`, `documents:write`, `documents:delete`)。
 * @returns Hono ミドルウェアハンドラー。
 */
export function requirePatScope(
  requiredScope: TokenScope,
): MiddlewareHandler<AppEnv> {
  return createPatAuthMiddleware({ required: true, scope: requiredScope });
}

/**
 * PAT による認可または Turnstile によるボット検証を行うミドルウェアを生成する。
 *
 * リクエストヘッダー `Authorization` に正当な PAT(要求スコープ保有)が指定されている場合は、
 * CLI 等の外部連携クライアントと判定して Turnstile ボット検証をバイパスする。
 * トークン未指定時は、Web ブラウザからのアクセスとして Turnstile ボット検証を実行する。
 *
 * @param requiredScope - PAT 指定時に要求されるスコープ名(既定値: `documents:write`)。
 * @returns Hono ミドルウェアハンドラー。
 */
export function createOptionalPatOrTurnstileMiddleware(
  requiredScope: TokenScope = 'documents:write',
): MiddlewareHandler<AppEnv> {
  const turnstileMiddleware = createTurnstileMiddleware<AppEnv>();

  return async (c, next) => {
    const authHeader = c.req.header('Authorization');
    const token = extractBearerToken(authHeader);

    if (token) {
      if (!isPat(token)) {
        return c.json(
          {
            error: {
              message: '無効な認証トークン形式です。',
            },
          },
          401,
        );
      }

      const patUser = await resolvePatAuth(c);
      if (!patUser) {
        return c.json(
          {
            error: {
              message: '無効または有効期限切れのPATトークンです。',
            },
          },
          401,
        );
      }

      if (!patUser.scopes.includes(requiredScope)) {
        return c.json(
          {
            error: {
              message: `操作に必要な権限(スコープ: ${requiredScope})がありません。`,
            },
          },
          403,
        );
      }

      return next();
    }

    return turnstileMiddleware(c, next);
  };
}
