/**
 * OAuth2認証およびセッション管理サブルーター。
 *
 * GitHub および Discord を認可プロバイダー（IdP）とする認可コードグラントフローと、
 * 署名付き JWT によるステートレスセッションのライフサイクルを提供する。
 *
 * 【クロスオリジンCookie伝搬に関する設計方針】:
 * 本 API はフロントエンド（Pages: `*.pages.dev`）と API（Workers: `*.workers.dev`）が別オリジンとなる
 * 構成に対応するため、CORS（`credentials: true`）および `SameSite=Lax` を設定している。
 * サードパーティ Cookie 規制（ITP 等）を回避するため、本番環境ではカスタムドメイン（同一 `eTLD+1`）
 * による運用、またはフロントエンド SSR（Service Binding）経由でのプロキシ中継を前提とする。
 */
import {
  AUTH_SESSION_COOKIE_NAME,
  AUTH_SESSION_EXPIRATION_SECONDS,
  OAUTH_PROVIDERS,
  OAUTH_RETURN_TO_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_STATE_EXPIRATION_SECONDS,
  RATE_LIMIT_AUTH_CALLBACK_LIMIT,
  RATE_LIMIT_AUTH_CALLBACK_WINDOW_SECONDS,
  RATE_LIMIT_AUTH_START_LIMIT,
  RATE_LIMIT_AUTH_START_WINDOW_SECONDS,
  timingSafeEqualHex,
  type AuthLogoutResponse,
  type AuthMeResponse,
  type OwnerProvider,
} from '@patto-md/shared';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import {
  getOAuthStrategy,
  resolveOAuthCredentials,
} from '../lib/oauth/index.ts';
import {
  createSessionToken,
  generateOAuthState,
  isSafeReturnToUrl,
} from '../lib/session.ts';
import { resolveJwtSecret } from '../lib/view-token.ts';
import { createRateLimitMiddleware } from '../middlewares/rate-limit.ts';
import { authSessionMiddleware } from '../middlewares/session.ts';
import type { AppEnv } from '../types.ts';

/** OAuth認証ルーター。 */
export const authRouter = new Hono<AppEnv>();

/**
 * コールバック受信 URL（`redirect_uri`）を解決する。
 *
 * @param env - Workers 環境変数。
 * @param requestUrl - リクエスト URL 文字列。
 * @param provider - 認証プロバイダー種別。
 * @returns 完全修飾コールバック URL。
 */
function resolveRedirectUri(
  env: AppEnv['Bindings'],
  requestUrl: string,
  provider: OwnerProvider,
): string {
  let baseUrl = env.AUTH_REDIRECT_BASE_URL?.trim();
  if (!baseUrl) {
    try {
      const url = new URL(requestUrl);
      baseUrl = url.origin;
    } catch {
      baseUrl = 'http://localhost:8787';
    }
  }
  baseUrl = baseUrl.replace(/\/+$/, '');
  return `${baseUrl}/api/auth/${provider}/callback`;
}

/**
 * フロントエンドのベースオリジン URL を解決する。
 *
 * @param env - Workers 環境変数。
 * @returns フロントエンドオリジン URL。
 */
function resolveFrontendOrigin(env: AppEnv['Bindings']): string {
  const origin = env.FRONTEND_ORIGIN?.trim();
  return origin && origin.length > 0
    ? origin.replace(/\/+$/, '')
    : 'http://localhost:4321';
}

/**
 * ログイン中ユーザー情報取得エンドポイント（`GET /api/auth/me`）。
 *
 * Cookie のセッション JWT を検証し、ログイン中のユーザー情報を返却する。未ログイン時は `user: null`。
 */
authRouter.get('/me', authSessionMiddleware(), (c) => {
  const user = c.get('user') ?? null;
  c.header('Cache-Control', 'private, no-cache, no-store');
  const responsePayload: AuthMeResponse = { user };
  return c.json(responsePayload, 200);
});

/**
 * ログアウトエンドポイント（`POST /api/auth/logout`）。
 *
 * セッション Cookie を破棄（`Max-Age=0`）する。
 */
authRouter.post('/logout', (c) => {
  const isSecure = c.req.url.startsWith('https:');
  deleteCookie(c, AUTH_SESSION_COOKIE_NAME, {
    path: '/',
    secure: isSecure,
  });
  c.header('Cache-Control', 'private, no-cache, no-store');
  const responsePayload: AuthLogoutResponse = { success: true };
  return c.json(responsePayload, 200);
});

/**
 * 認可開始エンドポイント（`GET /api/auth/:provider`）。
 *
 * CSRF 防止用の短命な `state` を生成・Cookie 保存し、指定プロバイダーの認可画面へリダイレクトする。
 * 外部 API 制限保護および DoS 防止のためレートリミットを適用する。
 */
authRouter.get(
  '/:provider',
  createRateLimitMiddleware({
    action: 'auth-start',
    limit: RATE_LIMIT_AUTH_START_LIMIT,
    windowSeconds: RATE_LIMIT_AUTH_START_WINDOW_SECONDS,
  }),
  async (c) => {
    const providerParam = c.req.param('provider');
    if (!OAUTH_PROVIDERS.includes(providerParam as OwnerProvider)) {
      return c.json(
        {
          error: {
            message: '未対応のOAuthプロバイダです。',
          },
        },
        400,
      );
    }
    const provider = providerParam as OwnerProvider;

    const credentials = resolveOAuthCredentials(provider, c.env);
    if (!credentials) {
      console.error(`OAuthクレデンシャル未設定: ${provider}`);
      return c.json(
        {
          error: {
            message: 'OAuthプロバイダの設定が不完全です。',
          },
        },
        500,
      );
    }

    const isSecure = c.req.url.startsWith('https:');
    const state = generateOAuthState();
    const redirectUri = resolveRedirectUri(c.env, c.req.url, provider);

    const strategy = getOAuthStrategy(provider);
    const authUrl = strategy.getAuthorizationUrl(
      state,
      redirectUri,
      credentials.clientId,
    );

    setCookie(c, OAUTH_STATE_COOKIE_NAME, state, {
      path: '/',
      maxAge: OAUTH_STATE_EXPIRATION_SECONDS,
      httpOnly: true,
      secure: isSecure,
      sameSite: 'Lax',
    });

    const returnTo = c.req.query('return_to');
    const frontendOrigin = resolveFrontendOrigin(c.env);
    if (returnTo && isSafeReturnToUrl(returnTo, [frontendOrigin])) {
      setCookie(c, OAUTH_RETURN_TO_COOKIE_NAME, returnTo, {
        path: '/',
        maxAge: OAUTH_STATE_EXPIRATION_SECONDS,
        httpOnly: true,
        secure: isSecure,
        sameSite: 'Lax',
      });
    }

    return c.redirect(authUrl, 302);
  },
);

/**
 * 認可コールバック受信エンドポイント（`GET /api/auth/:provider/callback`）。
 *
 * プロバイダーからの認可コードを受信し、`state` の CSRF 検証、トークン交換、
 * ユーザープロファイル取得、セッション JWT 発行を行い、フロントエンドへ復帰させる。
 * ブルートフォース攻撃防止のためレートリミットを適用する。
 */
authRouter.get(
  '/:provider/callback',
  createRateLimitMiddleware({
    action: 'auth-callback',
    limit: RATE_LIMIT_AUTH_CALLBACK_LIMIT,
    windowSeconds: RATE_LIMIT_AUTH_CALLBACK_WINDOW_SECONDS,
  }),
  async (c) => {
    const isSecure = c.req.url.startsWith('https:');
    const frontendOrigin = resolveFrontendOrigin(c.env);

    /** 一時 Cookie（state, return_to）を破棄するヘルパー。 */
    const clearTempCookies = () => {
      deleteCookie(c, OAUTH_STATE_COOKIE_NAME, {
        path: '/',
        secure: isSecure,
      });
      deleteCookie(c, OAUTH_RETURN_TO_COOKIE_NAME, {
        path: '/',
        secure: isSecure,
      });
    };

    const providerParam = c.req.param('provider');
    if (!OAUTH_PROVIDERS.includes(providerParam as OwnerProvider)) {
      clearTempCookies();
      return c.redirect(
        `${frontendOrigin}/?auth_error=unsupported_provider`,
        302,
      );
    }
    const provider = providerParam as OwnerProvider;

    const credentials = resolveOAuthCredentials(provider, c.env);
    if (!credentials) {
      clearTempCookies();
      return c.redirect(`${frontendOrigin}/?auth_error=server_error`, 302);
    }

    const errorParam = c.req.query('error');
    if (errorParam) {
      clearTempCookies();
      return c.redirect(`${frontendOrigin}/?auth_error=cancelled`, 302);
    }

    const queryState = c.req.query('state');
    const savedState = getCookie(c, OAUTH_STATE_COOKIE_NAME);

    if (
      !queryState ||
      !savedState ||
      !timingSafeEqualHex(queryState, savedState)
    ) {
      clearTempCookies();
      return c.redirect(`${frontendOrigin}/?auth_error=csrf_failed`, 302);
    }

    const code = c.req.query('code');
    if (!code) {
      clearTempCookies();
      return c.redirect(`${frontendOrigin}/?auth_error=invalid_request`, 302);
    }

    const redirectUri = resolveRedirectUri(c.env, c.req.url, provider);
    const strategy = getOAuthStrategy(provider);

    let user;
    try {
      const accessToken = await strategy.exchangeCode(
        code,
        redirectUri,
        credentials,
      );
      user = await strategy.getUserProfile(accessToken);
    } catch (error) {
      console.error(
        `OAuthトークン交換・プロファイル取得エラー (${provider}):`,
        error,
      );
      clearTempCookies();
      return c.redirect(`${frontendOrigin}/?auth_error=oauth_failed`, 302);
    }

    const secret = resolveJwtSecret(c.env);
    const { token } = await createSessionToken(user, secret);

    setCookie(c, AUTH_SESSION_COOKIE_NAME, token, {
      path: '/',
      maxAge: AUTH_SESSION_EXPIRATION_SECONDS,
      httpOnly: true,
      secure: isSecure,
      sameSite: 'Lax',
    });
    clearTempCookies();

    const savedReturnTo = getCookie(c, OAUTH_RETURN_TO_COOKIE_NAME);
    let destination = frontendOrigin;
    if (savedReturnTo && isSafeReturnToUrl(savedReturnTo, [frontendOrigin])) {
      if (savedReturnTo.startsWith('/')) {
        destination = `${frontendOrigin}${savedReturnTo}`;
      } else {
        destination = savedReturnTo;
      }
    }

    return c.redirect(destination, 302);
  },
);
