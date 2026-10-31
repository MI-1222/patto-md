/** OAuth認証セッション解決およびガード用 Hono ミドルウェア。 */
import { AUTH_SESSION_COOKIE_NAME, type AuthUser } from '@patto-md/shared';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { verifySessionToken } from '../lib/session.ts';
import { resolveJwtSecret } from '../lib/view-token.ts';
import type { AppEnv } from '../types.ts';

/**
 * Hono コンテキストからセッションユーザーを解決・取得する。
 *
 * コンテキストキャッシュ(`c.get('user')`)が存在する場合はそれを優先し、
 * 未解決の場合はリクエスト Cookie からセッション JWT を検証してコンテキストへ保存した上で返却する。
 * 未認証またはセッション無効時は `null` を返却する。
 *
 * @param c - Hono コンテキスト。
 * @returns 解決されたログインユーザー情報。未認証時は `null`。
 */
export async function resolveSessionUser(
  c: Context<AppEnv>,
): Promise<AuthUser | null> {
  const cachedUser = c.get('user');
  if (cachedUser !== undefined) {
    return cachedUser;
  }

  const token = getCookie(c, AUTH_SESSION_COOKIE_NAME);
  if (!token) {
    c.set('user', null);
    return null;
  }

  const secret = resolveJwtSecret(c.env);
  const user = await verifySessionToken(token, secret);
  c.set('user', user);
  return user;
}

/**
 * リクエストの Cookie からセッション JWT を検証し、ログインユーザー情報をコンテキストへ設定するミドルウェア。
 *
 * セッションが存在しない場合や無効な場合でも処理を遮断せず、`c.get('user')` に `null` を設定して後続へ渡す。
 *
 * @returns Hono ミドルウェアハンドラー。
 */
export function authSessionMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await resolveSessionUser(c);
    return next();
  };
}

/** ログイン済みセッションを必須とし、未認証リクエストを `401` で遮断するガードミドルウェア。 */
export function requireAuthMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) {
      return c.json(
        {
          error: {
            message: 'ログインが必要です。',
          },
        },
        401,
      );
    }

    return next();
  };
}
