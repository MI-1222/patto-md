/** 署名付きJWTによるステートレスセッションおよびCookie操作ユーティリティ。 */
import {
  AUTH_SESSION_COOKIE_NAME,
  AUTH_SESSION_EXPIRATION_SECONDS,
  OAUTH_RETURN_TO_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_STATE_EXPIRATION_SECONDS,
  type AuthUser,
  type OwnerProvider,
} from '@patto-md/shared';
import { sign, verify } from 'hono/jwt';

/** セッション `JWT` のペイロードインターフェース。 */
export interface SessionTokenPayload {
  /** 被認証者識別子(`provider:providerUserId`)。 */
  sub: string;
  /** 不変認証プロバイダ種別。 */
  provider: OwnerProvider;
  /** プロバイダ側の一意識別子。 */
  providerUserId: string;
  /** 表示用ユーザー名。 */
  username: string;
  /** アバター画像URL(`null` の場合は未設定)。 */
  avatarUrl: string | null;
  /** トークン有効期限(Unix秒)。 */
  exp: number;
  /** 発行日時(Unix秒)。 */
  iat: number;
  [key: string]: unknown;
}

/**
 * 暗号論的乱数を用いて CSRF 防御用の OAuth `state` 文字列を生成する。
 *
 * @returns 32バイト(64文字)の Hex 文字列。
 */
export function generateOAuthState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 認証ユーザー情報から署名付きセッション `JWT` を生成する。
 *
 * @param user - 認証済みユーザー情報。
 * @param secret - 署名用秘密鍵文字列。
 * @param ttlSeconds - 有効期間秒数(デフォルト: 7日間)。
 * @returns 生成されたトークンおよび ISO 8601 形式の有効期限日時。
 */
export async function createSessionToken(
  user: AuthUser,
  secret: string,
  ttlSeconds: number = AUTH_SESSION_EXPIRATION_SECONDS,
): Promise<{ token: string; expiresAt: string }> {
  const nowUnix = Math.floor(Date.now() / 1000);
  const expUnix = nowUnix + ttlSeconds;

  const payload: SessionTokenPayload = {
    sub: `${user.provider}:${user.providerUserId}`,
    provider: user.provider,
    providerUserId: user.providerUserId,
    username: user.username,
    avatarUrl: user.avatarUrl,
    iat: nowUnix,
    exp: expUnix,
  };

  const token = await sign(payload, secret, 'HS256');
  const expiresAt = new Date(expUnix * 1000).toISOString();

  return { token, expiresAt };
}

/**
 * セッション `JWT` を検証し、保持されているユーザー情報を復元する。
 *
 * @param token - 検証対象のセッション `JWT` 文字列。
 * @param secret - 署名用秘密鍵文字列。
 * @returns 復元されたユーザー情報。署名不正または期限切れ時は `null`。
 */
export async function verifySessionToken(
  token: string,
  secret: string,
): Promise<AuthUser | null> {
  if (!token || typeof token !== 'string') {
    return null;
  }

  try {
    const verified = (await verify(
      token,
      secret,
      'HS256',
    )) as unknown as SessionTokenPayload;

    if (
      !verified ||
      typeof verified !== 'object' ||
      !verified.provider ||
      !verified.providerUserId ||
      !verified.username
    ) {
      return null;
    }

    return {
      provider: verified.provider,
      providerUserId: verified.providerUserId,
      username: verified.username,
      avatarUrl:
        typeof verified.avatarUrl === 'string' ? verified.avatarUrl : null,
    };
  } catch {
    return null;
  }
}

/**
 * リクエスト `Cookie` ヘッダー文字列から指定された名前の `Cookie` 値を抽出する。
 *
 * @param cookieHeader - `Cookie` ヘッダー値。
 * @param name - 取得対象の `Cookie` 名。
 * @returns 抽出された値。未検出時は `null`。
 */
export function extractCookieValue(
  cookieHeader: string | undefined | null,
  name: string,
): string | null {
  if (!cookieHeader) {
    return null;
  }

  const prefix = `${name}=`;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      const raw = trimmed.slice(prefix.length);
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }

  return null;
}

/**
 * セッション保持用 `Set-Cookie` ヘッダー文字列を構築する。
 *
 * @param token - 発行されたセッション `JWT`。
 * @param ttlSeconds - 有効期間秒数。
 * @param isSecure - HTTPS 通信フラグ(デフォルト: true)。
 * @returns `Set-Cookie` ヘッダー値。
 */
export function buildSessionCookie(
  token: string,
  ttlSeconds: number = AUTH_SESSION_EXPIRATION_SECONDS,
  isSecure: boolean = true,
): string {
  const parts = [
    `${AUTH_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${ttlSeconds}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isSecure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * セッション破棄用 `Set-Cookie` ヘッダー文字列を構築する。
 *
 * @param isSecure - HTTPS 通信フラグ(デフォルト: true)。
 * @returns `Set-Cookie` ヘッダー値。
 */
export function buildClearSessionCookie(isSecure: boolean = true): string {
  const parts = [
    `${AUTH_SESSION_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isSecure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * OAuth CSRF対策用 `state` `Cookie` の `Set-Cookie` ヘッダー文字列を構築する。
 *
 * @param state - 生成された `state` 文字列。
 * @param isSecure - HTTPS 通信フラグ(デフォルト: true)。
 * @returns `Set-Cookie` ヘッダー値。
 */
export function buildOAuthStateCookie(
  state: string,
  isSecure: boolean = true,
): string {
  const parts = [
    `${OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(state)}`,
    'Path=/',
    `Max-Age=${OAUTH_STATE_EXPIRATION_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isSecure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * OAuth `state` `Cookie` 破棄用の `Set-Cookie` ヘッダー文字列を構築する。
 *
 * @param isSecure - HTTPS 通信フラグ(デフォルト: true)。
 * @returns `Set-Cookie` ヘッダー値。
 */
export function buildClearOAuthStateCookie(isSecure: boolean = true): string {
  const parts = [
    `${OAUTH_STATE_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isSecure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * OAuth リダイレクト復帰先 `Cookie` の `Set-Cookie` ヘッダー文字列を構築する。
 *
 * @param returnTo - 検証済みの復帰先 URL またはパス。
 * @param isSecure - HTTPS 通信フラグ(デフォルト: true)。
 * @returns `Set-Cookie` ヘッダー値。
 */
export function buildOAuthReturnToCookie(
  returnTo: string,
  isSecure: boolean = true,
): string {
  const parts = [
    `${OAUTH_RETURN_TO_COOKIE_NAME}=${encodeURIComponent(returnTo)}`,
    'Path=/',
    `Max-Age=${OAUTH_STATE_EXPIRATION_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isSecure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * OAuth リダイレクト復帰先 `Cookie` 破棄用の `Set-Cookie` ヘッダー文字列を構築する。
 *
 * @param isSecure - HTTPS 通信フラグ(デフォルト: true)。
 * @returns `Set-Cookie` ヘッダー値。
 */
export function buildClearOAuthReturnToCookie(
  isSecure: boolean = true,
): string {
  const parts = [
    `${OAUTH_RETURN_TO_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isSecure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * オープンリダイレクト脆弱性を防止するため、復帰先URLが安全か判定する。
 *
 * 先頭が `/` かつ `//` や `/\\` などのスキーム偽装を含まない相対パス形式、
 * または許可されたフロントエンドオリジン配下のURLのみを安全と判定する。
 *
 * @param candidate - 判定対象のURL候補文字列。
 * @param allowedOrigins - 許可するフロントエンドオリジン一覧。
 * @returns 安全であれば `true`、危険または不正な形式であれば `false`。
 */
export function isSafeReturnToUrl(
  candidate: string,
  allowedOrigins: string[] = [],
): boolean {
  if (!candidate || typeof candidate !== 'string') {
    return false;
  }

  const trimmed = candidate.trim();
  if (trimmed.length === 0) {
    return false;
  }

  if (
    trimmed.startsWith('/') &&
    !trimmed.startsWith('//') &&
    !trimmed.startsWith('/\\')
  ) {
    return true;
  }

  try {
    const parsed = new URL(trimmed);
    return allowedOrigins.some((origin) => {
      try {
        const allowed = new URL(origin);
        return parsed.origin === allowed.origin;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}
