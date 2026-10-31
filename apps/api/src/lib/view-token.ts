/** 閲覧認証トークン(`JWT`)の生成、検証、`Cookie` 処理を行うユーティリティ。 */

import {
  PASSCODE_AUTH_COOKIE_PREFIX,
  VIEW_TOKEN_EXPIRATION_SECONDS,
} from '@patto-md/shared';
import { sign, verify } from 'hono/jwt';
import type { AppBindings } from '../types.ts';

/** 閲覧認証 `JWT` のペイロードインターフェース。 */
export interface ViewTokenPayload {
  /** 閲覧認可されたドキュメント識別子(`Slug`)。 */
  docId: string;
  /** トークン有効期限(Unix秒)。 */
  exp: number;
  /** 発行日時(Unix秒)。 */
  iat: number;
  [key: string]: unknown;
}

/**
 * 閲覧トークンの署名用秘密鍵を解決する。
 *
 * 環境変数 `JWT_SECRET` が設定されていればそれを優先し、
 * 未設定時は `R2_SECRET_ACCESS_KEY` をフォールバックとして採用する。
 *
 * @param env - Cloudflare Workers 環境バインディング。
 * @returns 署名用秘密鍵文字列。
 */
export function resolveJwtSecret(env?: Partial<AppBindings>): string {
  if (
    env &&
    'JWT_SECRET' in env &&
    typeof env.JWT_SECRET === 'string' &&
    env.JWT_SECRET.length > 0
  ) {
    return env.JWT_SECRET;
  }
  if (
    env?.R2_SECRET_ACCESS_KEY &&
    typeof env.R2_SECRET_ACCESS_KEY === 'string' &&
    env.R2_SECRET_ACCESS_KEY.length > 0
  ) {
    return `patto_jwt_${env.R2_SECRET_ACCESS_KEY}`;
  }
  return 'patto-md-default-view-secret-key-change-in-production';
}

/**
 * 特定ドキュメントの閲覧認証 `JWT` および有効期限日時文字列を生成する。
 *
 * @param docId - ドキュメント識別子(`Slug`)。
 * @param secret - 署名用秘密鍵。
 * @param ttlSeconds - 有効期間秒数(デフォルト: 24時間)。
 * @returns 生成されたトークンおよび ISO 8601 形式の有効期限日時。
 */
export async function createViewToken(
  docId: string,
  secret: string,
  ttlSeconds: number = VIEW_TOKEN_EXPIRATION_SECONDS,
): Promise<{ token: string; expiresAt: string }> {
  const nowUnix = Math.floor(Date.now() / 1000);
  const expUnix = nowUnix + ttlSeconds;

  const payload: ViewTokenPayload = {
    docId,
    iat: nowUnix,
    exp: expUnix,
  };

  const token = await sign(payload, secret);
  const expiresAt = new Date(expUnix * 1000).toISOString();

  return {
    token,
    expiresAt,
  };
}

/**
 * 閲覧認証 `JWT` を検証し、対象ドキュメントの有効な閲覧権限であるか判定する。
 *
 * @param token - 検証対象の `JWT` 文字列。
 * @param docId - 照合対象のドキュメント識別子(`Slug`)。
 * @param secret - 署名用秘密鍵。
 * @returns 有効な権限であれば `true`、それ以外は `false`。
 */
export async function verifyViewToken(
  token: string,
  docId: string,
  secret: string,
): Promise<boolean> {
  if (!token || typeof token !== 'string') {
    return false;
  }

  try {
    const verified = (await verify(
      token,
      secret,
      'HS256',
    )) as unknown as ViewTokenPayload;
    if (!verified || typeof verified !== 'object') {
      return false;
    }

    if (verified.docId !== docId) {
      return false;
    }

    const nowUnix = Math.floor(Date.now() / 1000);
    if (typeof verified.exp === 'number' && verified.exp < nowUnix) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * ドキュメント固有のパスコード認証 `Cookie` 名を取得する。
 *
 * @param docId - ドキュメント識別子(`Slug`)。
 * @returns `Cookie` 名文字列。
 */
export function getPasscodeCookieName(docId: string): string {
  return `${PASSCODE_AUTH_COOKIE_PREFIX}${docId}`;
}

/**
 * `Cookie` ヘッダー文字列から指定したドキュメント用の閲覧トークンを抽出する。
 *
 * @param cookieHeader - `Cookie` ヘッダー文字列。
 * @param docId - ドキュメント識別子(`Slug`)。
 * @returns 抽出された `JWT` 文字列。存在しない場合は `null`。
 */
export function extractViewTokenFromCookie(
  cookieHeader: string | null | undefined,
  docId: string,
): string | null {
  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return null;
  }

  const cookieName = getPasscodeCookieName(docId);
  const cookies = cookieHeader.split(';');

  for (const cookie of cookies) {
    const [rawKey, ...valParts] = cookie.trim().split('=');
    if (rawKey === cookieName) {
      const rawValue = valParts.join('=').trim();
      return rawValue.length > 0 ? decodeURIComponent(rawValue) : null;
    }
  }

  return null;
}

/**
 * パスコード認証成功時の `Set-Cookie` ヘッダー値を構築する。
 *
 * @param docId - ドキュメント識別子(`Slug`)。
 * @param token - 閲覧認証 `JWT`。
 * @param maxAgeSeconds - 有効期間秒数(デフォルト: 24時間)。
 * @returns `Set-Cookie` ヘッダー文字列。
 */
export function buildPasscodeSetCookieHeader(
  docId: string,
  token: string,
  maxAgeSeconds: number = VIEW_TOKEN_EXPIRATION_SECONDS,
): string {
  const cookieName = getPasscodeCookieName(docId);
  return `${cookieName}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}
