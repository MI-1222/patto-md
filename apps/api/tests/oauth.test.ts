/** OAuth2認証基盤およびセッション管理の単体テスト。 */
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  AUTH_SESSION_COOKIE_NAME,
  OAUTH_RETURN_TO_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
  type AuthUser,
} from '@patto-md/shared';
import { Hono } from 'hono';
import { discordOAuthStrategy } from '../src/lib/oauth/discord.ts';
import { githubOAuthStrategy } from '../src/lib/oauth/github.ts';
import {
  createSessionToken,
  extractCookieValue,
  generateOAuthState,
  isSafeReturnToUrl,
  verifySessionToken,
} from '../src/lib/session.ts';
import {
  authSessionMiddleware,
  requireAuthMiddleware,
} from '../src/middlewares/session.ts';
import { authRouter } from '../src/routes/auth.ts';
import type { AppBindings, AppEnv } from '../src/types.ts';

describe('OAuth state および リダイレクト安全性検証 (session.ts)', () => {
  test('generateOAuthState が 64 文字の 16 進数文字列を一意に生成すること。', () => {
    const s1 = generateOAuthState();
    const s2 = generateOAuthState();
    assert.equal(s1.length, 64);
    assert.equal(s2.length, 64);
    assert.match(s1, /^[0-9a-f]{64}$/);
    assert.notEqual(s1, s2);
  });

  test('isSafeReturnToUrl が安全な相対パスおよび許可オリジン配下のURLを正しく判定すること。', () => {
    const allowed = ['http://localhost:4321', 'https://patto.example.com'];

    // 安全な相対パス。
    assert.equal(isSafeReturnToUrl('/', allowed), true);
    assert.equal(isSafeReturnToUrl('/documents', allowed), true);
    assert.equal(isSafeReturnToUrl('/p/AbCdEf123456', allowed), true);

    // スキーム偽装を含む危険なパス。
    assert.equal(isSafeReturnToUrl('//evil.com', allowed), false);
    assert.equal(isSafeReturnToUrl('/\\evil.com', allowed), false);
    assert.equal(isSafeReturnToUrl('', allowed), false);

    // 許可オリジン配下。
    assert.equal(
      isSafeReturnToUrl('http://localhost:4321/dashboard', allowed),
      true,
    );
    assert.equal(
      isSafeReturnToUrl('https://patto.example.com/settings', allowed),
      true,
    );

    // 許可外オリジンの絶対 URL。
    assert.equal(
      isSafeReturnToUrl('https://evil.com/phishing', allowed),
      false,
    );
  });

  test('extractCookieValue が Cookie ヘッダーから目的の値を抽出できること。', () => {
    const header = `${AUTH_SESSION_COOKIE_NAME}=token123; other=abc; ${OAUTH_STATE_COOKIE_NAME}=state456`;
    assert.equal(
      extractCookieValue(header, AUTH_SESSION_COOKIE_NAME),
      'token123',
    );
    assert.equal(
      extractCookieValue(header, OAUTH_STATE_COOKIE_NAME),
      'state456',
    );
    assert.equal(extractCookieValue(header, 'not_found'), null);
    assert.equal(extractCookieValue(undefined, 'key'), null);
  });
});

describe('セッション JWT の生成と検証 (session.ts)', () => {
  const dummySecret = 'test-session-secret-key-12345678901234567890';
  const dummyUser: AuthUser = {
    provider: 'github',
    providerUserId: '12345678',
    username: 'test-user',
    avatarUrl: 'https://example.com/avatar.png',
  };

  test('認証ユーザー情報から正当なセッション JWT が生成・検証できること。', async () => {
    const { token, expiresAt } = await createSessionToken(
      dummyUser,
      dummySecret,
      3600,
    );
    assert.ok(token);
    assert.ok(expiresAt);

    const verified = await verifySessionToken(token, dummySecret);
    assert.ok(verified);
    assert.equal(verified.provider, 'github');
    assert.equal(verified.providerUserId, '12345678');
    assert.equal(verified.username, 'test-user');
    assert.equal(verified.avatarUrl, 'https://example.com/avatar.png');
  });

  test('異なるシークレットキーでは検証が失敗 (null) すること。', async () => {
    const { token } = await createSessionToken(dummyUser, dummySecret, 3600);
    const verified = await verifySessionToken(token, 'different-secret-key');
    assert.equal(verified, null);
  });

  test('改ざんされたトークンは検証が失敗すること。', async () => {
    const { token } = await createSessionToken(dummyUser, dummySecret, 3600);
    const tampered = token.slice(0, -5) + 'xxxxx';
    const verified = await verifySessionToken(tampered, dummySecret);
    assert.equal(verified, null);
  });
});

describe('プロバイダ固有ストラテジー (github.ts & discord.ts)', () => {
  test('GitHub 認可 URL が期待通りのパラメータで生成されること。', () => {
    const url = githubOAuthStrategy.getAuthorizationUrl(
      'state123',
      'http://localhost:8787/api/auth/github/callback',
      'gh-client-id',
    );
    assert.ok(url.includes('https://github.com/login/oauth/authorize'));
    assert.ok(url.includes('client_id=gh-client-id'));
    assert.ok(url.includes('scope=read%3Auser'));
    assert.ok(url.includes('state=state123'));
  });

  test('Discord 認可 URL が期待通りのパラメータで生成されること。', () => {
    const url = discordOAuthStrategy.getAuthorizationUrl(
      'state456',
      'http://localhost:8787/api/auth/discord/callback',
      'dc-client-id',
    );
    assert.ok(url.includes('https://discord.com/oauth2/authorize'));
    assert.ok(url.includes('client_id=dc-client-id'));
    assert.ok(url.includes('response_type=code'));
    assert.ok(url.includes('scope=identify'));
    assert.ok(url.includes('state=state456'));
  });
});

describe('OAuth2 認証サブルーター (routes/auth.ts)', () => {
  const mockEnv: Partial<AppBindings> = {
    GITHUB_CLIENT_ID: 'mock-gh-client-id',
    GITHUB_CLIENT_SECRET: 'mock-gh-client-secret',
    DISCORD_CLIENT_ID: 'mock-dc-client-id',
    DISCORD_CLIENT_SECRET: 'mock-dc-client-secret',
    JWT_SECRET: 'test-jwt-secret-for-auth-testing-12345678',
    FRONTEND_ORIGIN: 'http://localhost:4321',
  };

  test('GET /:provider で未対応プロバイダを指定した場合は 400 を返却すること。', async () => {
    const app = new Hono<AppEnv>();
    app.route('/api/auth', authRouter);

    const res = await app.request('/api/auth/unknown-provider', {
      method: 'GET',
    });
    assert.equal(res.status, 400);
  });

  test('GET /:provider でクレデンシャルが未設定の場合は 500 を返却すること。', async () => {
    const app = new Hono<AppEnv>();
    app.route('/api/auth', authRouter);

    const res = await app.request(
      '/api/auth/github',
      { method: 'GET' },
      {} as unknown as AppBindings,
    );
    assert.equal(res.status, 500);
  });

  test('GET /:provider で認可 URL への 302 リダイレクトと state Cookie が設定されること。', async () => {
    const app = new Hono<AppEnv>();
    app.route('/api/auth', authRouter);

    const res = await app.request(
      '/api/auth/github?return_to=/my-page',
      { method: 'GET' },
      mockEnv as unknown as AppBindings,
    );

    assert.equal(res.status, 302);
    const location = res.headers.get('Location');
    assert.ok(location?.startsWith('https://github.com/login/oauth/authorize'));

    const setCookies = res.headers.getSetCookie();
    assert.ok(
      setCookies.some((c) => c.includes(`${OAUTH_STATE_COOKIE_NAME}=`)),
    );
    assert.ok(
      setCookies.some((c) => c.includes(`${OAUTH_RETURN_TO_COOKIE_NAME}=`)),
    );
  });

  test('GET /:provider/callback でユーザーがキャンセルした場合はエラーリダイレクトすること。', async () => {
    const app = new Hono<AppEnv>();
    app.route('/api/auth', authRouter);

    const res = await app.request(
      '/api/auth/github/callback?error=access_denied',
      { method: 'GET' },
      mockEnv as unknown as AppBindings,
    );

    assert.equal(res.status, 302);
    const location = res.headers.get('Location');
    assert.equal(location, 'http://localhost:4321/?auth_error=cancelled');
  });

  test('GET /:provider/callback で state が不一致の場合は csrf_failed エラー画面へ 302 リダイレクトすること。', async () => {
    const app = new Hono<AppEnv>();
    app.route('/api/auth', authRouter);

    const validState = generateOAuthState();
    const wrongState = generateOAuthState();

    const res = await app.request(
      `/api/auth/github/callback?code=test-code&state=${wrongState}`,
      {
        method: 'GET',
        headers: {
          Cookie: `${OAUTH_STATE_COOKIE_NAME}=${validState}`,
        },
      },
      mockEnv as unknown as AppBindings,
    );

    assert.equal(res.status, 302);
    assert.equal(
      res.headers.get('Location'),
      'http://localhost:4321/?auth_error=csrf_failed',
    );
  });

  test('GET /:provider/callback で認可コードが欠落している場合は invalid_request エラー画面へ 302 リダイレクトすること。', async () => {
    const app = new Hono<AppEnv>();
    app.route('/api/auth', authRouter);

    const validState = generateOAuthState();

    const res = await app.request(
      `/api/auth/github/callback?state=${validState}`,
      {
        method: 'GET',
        headers: {
          Cookie: `${OAUTH_STATE_COOKIE_NAME}=${validState}`,
        },
      },
      mockEnv as unknown as AppBindings,
    );

    assert.equal(res.status, 302);
    assert.equal(
      res.headers.get('Location'),
      'http://localhost:4321/?auth_error=invalid_request',
    );
  });

  test('GET /:provider/callback で認可が成功した場合、セッション Cookie を発行して復帰先へリダイレクトすること。', async () => {
    const app = new Hono<AppEnv>();
    app.route('/api/auth', authRouter);

    const validState = generateOAuthState();

    // fetch のモック（GitHub のトークン交換およびプロファイル取得）。
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(input);
      if (urlStr.includes('github.com/login/oauth/access_token')) {
        return new Response(
          JSON.stringify({
            access_token: 'gho_mock_access_token_12345',
            token_type: 'bearer',
            scope: 'read:user',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (urlStr.includes('api.github.com/user')) {
        return new Response(
          JSON.stringify({
            id: 99887766,
            login: 'octocat',
            name: 'Mona Lisa Octocat',
            avatar_url: 'https://github.com/images/error/octocat_happy.gif',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return originalFetch(input, init);
    };

    try {
      const res = await app.request(
        `/api/auth/github/callback?code=mock-code&state=${validState}`,
        {
          method: 'GET',
          headers: {
            Cookie: `${OAUTH_STATE_COOKIE_NAME}=${validState}; ${OAUTH_RETURN_TO_COOKIE_NAME}=%2Fdashboard`,
          },
        },
        mockEnv as unknown as AppBindings,
      );

      assert.equal(res.status, 302);
      assert.equal(
        res.headers.get('Location'),
        'http://localhost:4321/dashboard',
      );

      const setCookies = res.headers.getSetCookie();
      assert.ok(
        setCookies.some((c) => c.includes(`${AUTH_SESSION_COOKIE_NAME}=`)),
      );
      assert.ok(
        setCookies.some(
          (c) =>
            c.includes(`${OAUTH_STATE_COOKIE_NAME}=`) &&
            c.includes('Max-Age=0'),
        ),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('GET /me で未ログイン時は user: null が返却されること。', async () => {
    const app = new Hono<AppEnv>();
    app.route('/api/auth', authRouter);

    const res = await app.request(
      '/api/auth/me',
      { method: 'GET' },
      mockEnv as unknown as AppBindings,
    );

    assert.equal(res.status, 200);
    const body = (await res.json()) as { user: unknown };
    assert.equal(body.user, null);
  });

  test('GET /me で有効なセッション Cookie がある場合はユーザー情報が返却されること。', async () => {
    const app = new Hono<AppEnv>();
    app.route('/api/auth', authRouter);

    const dummyUser: AuthUser = {
      provider: 'discord',
      providerUserId: '987654321012345678',
      username: 'discord_hero',
      avatarUrl: null,
    };
    const { token } = await createSessionToken(
      dummyUser,
      mockEnv.JWT_SECRET!,
      3600,
    );

    const res = await app.request(
      '/api/auth/me',
      {
        method: 'GET',
        headers: {
          Cookie: `${AUTH_SESSION_COOKIE_NAME}=${token}`,
        },
      },
      mockEnv as unknown as AppBindings,
    );

    assert.equal(res.status, 200);
    const body = (await res.json()) as { user: AuthUser };
    assert.ok(body.user);
    assert.equal(body.user.provider, 'discord');
    assert.equal(body.user.providerUserId, '987654321012345678');
    assert.equal(body.user.username, 'discord_hero');
  });

  test('POST /logout でセッション Cookie が破棄されること。', async () => {
    const app = new Hono<AppEnv>();
    app.route('/api/auth', authRouter);

    const res = await app.request('/api/auth/logout', {
      method: 'POST',
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { success: boolean };
    assert.equal(body.success, true);

    const setCookie = res.headers.get('Set-Cookie');
    assert.ok(setCookie?.includes(`${AUTH_SESSION_COOKIE_NAME}=`));
    assert.ok(setCookie?.includes('Max-Age=0'));
  });

  test('認可開始エンドポイントで10回を超過するリクエストに対して 429 を返却すること。', async () => {
    const app = new Hono<AppEnv>();
    app.route('/api/auth', authRouter);

    for (let i = 0; i < 10; i++) {
      const res = await app.request(
        '/api/auth/github',
        {
          method: 'GET',
          headers: { 'CF-Connecting-IP': '198.51.100.22' },
        },
        mockEnv as unknown as AppBindings,
      );
      assert.equal(res.status, 302);
    }

    const rateLimitedRes = await app.request(
      '/api/auth/github',
      {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '198.51.100.22' },
      },
      mockEnv as unknown as AppBindings,
    );
    assert.equal(rateLimitedRes.status, 429);
    assert.ok(rateLimitedRes.headers.get('Retry-After'));
  });
});

describe('セッション認可ガードミドルウェア (middlewares/session.ts)', () => {
  test('requireAuthMiddleware が未ログイン時に 401 で遮断し、ログイン時は通過すること。', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', authSessionMiddleware());

    app.get('/api/protected', requireAuthMiddleware(), (c) => {
      const user = c.get('user')!;
      return c.json({ ok: true, user });
    });

    const mockSecret = 'test-secret-1234';
    const env: Partial<AppBindings> = { JWT_SECRET: mockSecret };

    // 未認証アクセス。
    const unauthRes = await app.request(
      '/api/protected',
      { method: 'GET' },
      env as unknown as AppBindings,
    );
    assert.equal(unauthRes.status, 401);

    // 認証済みアクセス。
    const { token } = await createSessionToken(
      {
        provider: 'github',
        providerUserId: '111',
        username: 'alice',
        avatarUrl: null,
      },
      mockSecret,
    );

    const authRes = await app.request(
      '/api/protected',
      {
        method: 'GET',
        headers: {
          Cookie: `${AUTH_SESSION_COOKIE_NAME}=${token}`,
        },
      },
      env as unknown as AppBindings,
    );
    assert.equal(authRes.status, 200);
    const body = (await authRes.json()) as { ok: boolean; user: AuthUser };
    assert.equal(body.ok, true);
    assert.equal(body.user.username, 'alice');
  });
});
