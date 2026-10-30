import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { Hono } from 'hono';
import {
  createTurnstileMiddleware,
  isLocalOrPrivateIp,
  TURNSTILE_TEST_SECRET_KEY_BLOCK,
  TURNSTILE_TEST_SECRET_KEY_PASS,
  TURNSTILE_TEST_SITE_KEY_BLOCK,
  TURNSTILE_TEST_SITE_KEY_PASS,
  TURNSTILE_TOKEN_HEADER,
  type TurnstileBindings,
  verifyTurnstileToken,
} from '../src/lib/turnstile.ts';

describe('Turnstile IP 判定処理 (isLocalOrPrivateIp)', () => {
  test('ローカルホストおよびループバックアドレスを正しく検出すること。', () => {
    assert.strictEqual(isLocalOrPrivateIp('127.0.0.1'), true);
    assert.strictEqual(isLocalOrPrivateIp('::1'), true);
    assert.strictEqual(isLocalOrPrivateIp('localhost'), true);
  });

  test('プライベート IP 範囲を正しく検出すること。', () => {
    assert.strictEqual(isLocalOrPrivateIp('192.168.1.1'), true);
    assert.strictEqual(isLocalOrPrivateIp('10.0.0.1'), true);
    assert.strictEqual(isLocalOrPrivateIp('172.16.0.1'), true);
    assert.strictEqual(isLocalOrPrivateIp('172.31.255.255'), true);
  });

  test('パブリック IP アドレスでは false を返却すること。', () => {
    assert.strictEqual(isLocalOrPrivateIp('203.0.113.195'), false);
    assert.strictEqual(isLocalOrPrivateIp('8.8.8.8'), false);
    assert.strictEqual(isLocalOrPrivateIp('1.1.1.1'), false);
  });
});

describe('Turnstile トークン検証ロジック (verifyTurnstileToken)', () => {
  test('シークレットキーが未指定の場合は失敗すること。', async () => {
    const result = await verifyTurnstileToken({
      secretKey: '',
      token: 'some-token',
    });
    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(result.errorCodes, ['missing-secret-key']);
  });

  test('トークンが未指定の場合は失敗すること。', async () => {
    const result = await verifyTurnstileToken({
      secretKey: 'some-secret',
      token: '',
    });
    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(result.errorCodes, ['missing-input-response']);
  });

  test('テスト用 Always Pass キーでは即時検証成功すること。', async () => {
    const result = await verifyTurnstileToken({
      secretKey: TURNSTILE_TEST_SECRET_KEY_PASS,
      token: 'test-token',
    });
    assert.strictEqual(result.success, true);
  });

  test('テスト用 Always Block キーでは即時検証失敗すること。', async () => {
    const result = await verifyTurnstileToken({
      secretKey: TURNSTILE_TEST_SECRET_KEY_BLOCK,
      token: 'test-token',
    });
    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(result.errorCodes, ['invalid-input-response']);
  });

  test('モック fetch による Siteverify API 正常系を検証できること。', async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          success: true,
          challenge_ts: '2026-10-30T00:00:00.000Z',
          hostname: 'patto-md.local',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

    const result = await verifyTurnstileToken({
      secretKey: 'custom-secret',
      token: 'valid-token',
      customFetch: mockFetch as unknown as typeof fetch,
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.hostname, 'patto-md.local');
  });

  test('Siteverify API 通信エラー時 (Fail-close) に安全に失敗すること。', async () => {
    const mockFetch = async () => {
      throw new Error('Network timeout');
    };

    const result = await verifyTurnstileToken({
      secretKey: 'custom-secret',
      token: 'valid-token',
      customFetch: mockFetch as unknown as typeof fetch,
    });
    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(result.errorCodes, ['internal-verification-error']);
  });
});

describe('Turnstile Hono ミドルウェア (createTurnstileMiddleware)', () => {
  /** テスト用 Hono アプリケーションを構築する。 */
  function createTestApp(options?: { required?: boolean; secretKey?: string }) {
    const app = new Hono<{ Bindings: TurnstileBindings }>();
    const secretKey =
      options?.secretKey !== undefined
        ? options.secretKey
        : TURNSTILE_TEST_SECRET_KEY_PASS;

    // テスト用の環境変数モック注入。
    app.use('*', async (c, next) => {
      c.env = {
        TURNSTILE_SECRET_KEY: secretKey,
      };
      await next();
    });

    app.post(
      '/test-endpoint',
      createTurnstileMiddleware({ required: options?.required }),
      (c) => c.json({ status: 'ok' }, 200),
    );

    return app;
  }

  test('トークンヘッダーが欠落している場合、400 Bad Request を返却すること。', async () => {
    const app = createTestApp({ required: true });
    const res = await app.request('/test-endpoint', {
      method: 'POST',
    });
    assert.strictEqual(res.status, 400);
    const body = (await res.json()) as { error: { message: string } };
    assert.strictEqual(
      body.error.message,
      'ボット検証トークンが指定されていません。',
    );
  });

  test('required: false 設定時、トークンが無くても次へ進むこと。', async () => {
    const app = createTestApp({ required: false });
    const res = await app.request('/test-endpoint', {
      method: 'POST',
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { status: string };
    assert.strictEqual(body.status, 'ok');
  });

  test('シークレットキーが未設定の場合、500 Internal Server Error を返却すること。', async () => {
    const app = createTestApp({ secretKey: '' });
    const res = await app.request('/test-endpoint', {
      method: 'POST',
      headers: {
        [TURNSTILE_TOKEN_HEADER]: 'dummy-token',
      },
    });
    assert.strictEqual(res.status, 500);
  });

  test('検証失敗時、403 Forbidden を返却すること。', async () => {
    const app = createTestApp({ secretKey: TURNSTILE_TEST_SECRET_KEY_BLOCK });
    const res = await app.request('/test-endpoint', {
      method: 'POST',
      headers: {
        [TURNSTILE_TOKEN_HEADER]: TURNSTILE_TEST_SITE_KEY_BLOCK,
      },
    });
    assert.strictEqual(res.status, 403);
  });

  test('正当なトークン検証時、200 OK で通過すること。', async () => {
    const app = createTestApp({ secretKey: TURNSTILE_TEST_SECRET_KEY_PASS });
    const res = await app.request('/test-endpoint', {
      method: 'POST',
      headers: {
        [TURNSTILE_TOKEN_HEADER]: TURNSTILE_TEST_SITE_KEY_PASS,
      },
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { status: string };
    assert.strictEqual(body.status, 'ok');
  });
});
