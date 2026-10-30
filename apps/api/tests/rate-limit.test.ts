import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  RATE_LIMIT_DOCUMENT_COMMIT_LIMIT,
  RATE_LIMIT_EXCEEDED_MESSAGE,
  RATE_LIMIT_UPLOAD_SIGN_LIMIT,
} from '@patto-md/shared/constants/limits';
import { Hono } from 'hono';
import {
  CacheRateLimitStore,
  checkRateLimit,
  createRateLimitMiddleware,
  getClientIp,
  InMemoryRateLimitStore,
} from '../src/lib/rate-limit.ts';

describe('IP アドレス抽出処理 (getClientIp)', () => {
  test('cf-connecting-ip ヘッダーを最優先で取得すること。', () => {
    const app = new Hono();
    let extractedIp = '';
    app.get('/test-ip', (c) => {
      extractedIp = getClientIp(c);
      return c.text('ok');
    });

    app.request('/test-ip', {
      headers: {
        'cf-connecting-ip': '203.0.113.10',
        'x-forwarded-for': '198.51.100.20, 192.0.2.1',
      },
    });

    assert.strictEqual(extractedIp, '203.0.113.10');
  });

  test('cf-connecting-ip が未設定時、x-forwarded-for の先頭 IP を取得すること。', () => {
    const app = new Hono();
    let extractedIp = '';
    app.get('/test-ip', (c) => {
      extractedIp = getClientIp(c);
      return c.text('ok');
    });

    app.request('/test-ip', {
      headers: {
        'x-forwarded-for': ' 198.51.100.20 , 192.0.2.1 ',
      },
    });

    assert.strictEqual(extractedIp, '198.51.100.20');
  });

  test('ヘッダーが存在しない場合は 127.0.0.1 へフォールバックすること。', () => {
    const app = new Hono();
    let extractedIp = '';
    app.get('/test-ip', (c) => {
      extractedIp = getClientIp(c);
      return c.text('ok');
    });

    app.request('/test-ip');

    assert.strictEqual(extractedIp, '127.0.0.1');
  });
});

describe('インメモリストア (InMemoryRateLimitStore)', () => {
  test('カウントが1から順に増加すること。', async () => {
    const store = new InMemoryRateLimitStore();
    const now = 1000000;

    const res1 = await store.increment('test-key', 60, now);
    assert.strictEqual(res1.count, 1);
    assert.strictEqual(res1.resetAt, 1020);

    const res2 = await store.increment('test-key', 60, now + 1000);
    assert.strictEqual(res2.count, 2);
    assert.strictEqual(res2.resetAt, 1020);
  });

  test('古いエントリが期限切れで自動削除されること。', async () => {
    const store = new InMemoryRateLimitStore();
    const windowSeconds = 60;
    const initialNow = 1000 * 1000;

    await store.increment('key-1', windowSeconds, initialNow);
    assert.strictEqual(store.size(), 1);

    // ウィンドウ期間経過後のアクセスで古いエントリがパージされる。
    const afterExpirationNow = (1000 + windowSeconds + 1) * 1000;
    await store.increment('key-2', windowSeconds, afterExpirationNow);

    // key-1 はパージされ、key-2 のみ残る。
    assert.strictEqual(store.size(), 1);
  });

  test('最大エントリ数を超過した場合に古いエントリが破棄されること。', async () => {
    const maxEntries = 3;
    const store = new InMemoryRateLimitStore(maxEntries);
    const now = 1000 * 1000;

    await store.increment('key-1', 60, now);
    await store.increment('key-2', 60, now);
    await store.increment('key-3', 60, now);
    assert.strictEqual(store.size(), 3);

    // 4件目を追加すると古いエントリが破棄される。
    await store.increment('key-4', 60, now);
    assert.strictEqual(store.size(), 3);
  });
});

describe('キャッシュストア (CacheRateLimitStore)', () => {
  test('Cache API 非対応環境ではメモリフォールバックで正常にインクリメントできること。', async () => {
    const store = new CacheRateLimitStore();
    const now = 1000 * 1000;

    const res1 = await store.increment('cache-test-key', 60, now);
    assert.strictEqual(res1.count, 1);

    const res2 = await store.increment('cache-test-key', 60, now);
    assert.strictEqual(res2.count, 2);
  });

  test('Cache API が利用可能な場合にキャッシュの読み書きとインクリメントが行われること。', async () => {
    const cachedEntries = new Map<string, Response>();
    const mockCache = {
      async match(request: Request) {
        return cachedEntries.get(request.url) || null;
      },
      async put(request: Request, response: Response) {
        cachedEntries.set(request.url, response);
      },
    };

    // グローバル caches を一時的にモック化する。
    const originalCaches = (globalThis as unknown as { caches?: unknown })
      .caches;
    (
      globalThis as unknown as { caches: { default: typeof mockCache } }
    ).caches = {
      default: mockCache,
    };

    try {
      const store = new CacheRateLimitStore();
      const now = 1000 * 1000;

      const res1 = await store.increment('mock-cache-key', 60, now);
      assert.strictEqual(res1.count, 1);
      assert.strictEqual(cachedEntries.size, 1);

      const res2 = await store.increment('mock-cache-key', 60, now);
      assert.strictEqual(res2.count, 2);
    } finally {
      (globalThis as unknown as { caches?: unknown }).caches = originalCaches;
    }
  });
});

describe('レートリミット判定ロジック (checkRateLimit)', () => {
  test('制限枠内では allowed: true と正しい残枠数が返却されること。', async () => {
    const store = new InMemoryRateLimitStore();
    const currentNow = 1000 * 1000;
    const nowFn = () => currentNow;

    const result1 = await checkRateLimit({
      action: 'test-action',
      clientIp: '1.2.3.4',
      limit: 3,
      windowSeconds: 60,
      store,
      now: nowFn,
    });

    assert.strictEqual(result1.allowed, true);
    assert.strictEqual(result1.limit, 3);
    assert.strictEqual(result1.remaining, 2);
    assert.strictEqual(result1.retryAfter, 0);

    const result2 = await checkRateLimit({
      action: 'test-action',
      clientIp: '1.2.3.4',
      limit: 3,
      windowSeconds: 60,
      store,
      now: nowFn,
    });
    assert.strictEqual(result2.allowed, true);
    assert.strictEqual(result2.remaining, 1);

    const result3 = await checkRateLimit({
      action: 'test-action',
      clientIp: '1.2.3.4',
      limit: 3,
      windowSeconds: 60,
      store,
      now: nowFn,
    });
    assert.strictEqual(result3.allowed, true);
    assert.strictEqual(result3.remaining, 0);
  });

  test('制限上限を超過したリクエストでは allowed: false と Retry-After が返却されること。', async () => {
    const store = new InMemoryRateLimitStore();
    const currentNow = 1000 * 1000;
    const nowFn = () => currentNow;

    for (let i = 0; i < 3; i++) {
      await checkRateLimit({
        action: 'test-action',
        clientIp: '1.2.3.4',
        limit: 3,
        windowSeconds: 60,
        store,
        now: nowFn,
      });
    }

    // 4回目のリクエストで超過。
    const exceededResult = await checkRateLimit({
      action: 'test-action',
      clientIp: '1.2.3.4',
      limit: 3,
      windowSeconds: 60,
      store,
      now: nowFn,
    });

    assert.strictEqual(exceededResult.allowed, false);
    assert.strictEqual(exceededResult.remaining, 0);
    assert.ok(exceededResult.retryAfter >= 1);
  });

  test('異なる IP アドレス間では独立して集計されること。', async () => {
    const store = new InMemoryRateLimitStore();
    const nowFn = () => 1000 * 1000;

    const ip1Result = await checkRateLimit({
      action: 'test-action',
      clientIp: '10.0.0.1',
      limit: 3,
      windowSeconds: 60,
      store,
      now: nowFn,
    });
    assert.strictEqual(ip1Result.remaining, 2);

    const ip2Result = await checkRateLimit({
      action: 'test-action',
      clientIp: '10.0.0.2',
      limit: 3,
      windowSeconds: 60,
      store,
      now: nowFn,
    });
    assert.strictEqual(ip2Result.remaining, 2);
  });

  test('異なる action 間では同一 IP であっても独立して集計されること。', async () => {
    const store = new InMemoryRateLimitStore();
    const nowFn = () => 1000 * 1000;

    const action1Result = await checkRateLimit({
      action: 'action-1',
      clientIp: '10.0.0.1',
      limit: 3,
      windowSeconds: 60,
      store,
      now: nowFn,
    });
    assert.strictEqual(action1Result.remaining, 2);

    const action2Result = await checkRateLimit({
      action: 'action-2',
      clientIp: '10.0.0.1',
      limit: 3,
      windowSeconds: 60,
      store,
      now: nowFn,
    });
    assert.strictEqual(action2Result.remaining, 2);
  });

  test('ウィンドウ期間経過後にカウントがリセットされること。', async () => {
    const store = new InMemoryRateLimitStore();
    let currentNow = 1000 * 1000;
    const nowFn = () => currentNow;

    for (let i = 0; i < 3; i++) {
      await checkRateLimit({
        action: 'test-action',
        clientIp: '10.0.0.1',
        limit: 3,
        windowSeconds: 60,
        store,
        now: nowFn,
      });
    }

    const exceededResult = await checkRateLimit({
      action: 'test-action',
      clientIp: '10.0.0.1',
      limit: 3,
      windowSeconds: 60,
      store,
      now: nowFn,
    });
    assert.strictEqual(exceededResult.allowed, false);

    // 61秒進めて次のウィンドウにする。
    currentNow += 61 * 1000;

    const newWindowResult = await checkRateLimit({
      action: 'test-action',
      clientIp: '10.0.0.1',
      limit: 3,
      windowSeconds: 60,
      store,
      now: nowFn,
    });
    assert.strictEqual(newWindowResult.allowed, true);
    assert.strictEqual(newWindowResult.remaining, 2);
  });
});

describe('Hono レートリミットミドルウェア (createRateLimitMiddleware)', () => {
  /** テスト用 Hono アプリケーションを構築する。 */
  function createTestApp(options: {
    limit: number;
    windowSeconds?: number;
    action: string;
    nowFn?: () => number;
  }) {
    const app = new Hono();
    const store = new InMemoryRateLimitStore();

    app.use(
      '/api/*',
      createRateLimitMiddleware({
        limit: options.limit,
        windowSeconds: options.windowSeconds,
        action: options.action,
        store,
        now: options.nowFn,
      }),
    );

    app.options('/api/test', (c) => c.text('options-ok', 200));
    app.post('/api/test', (c) => c.json({ status: 'ok' }, 200));

    return { app, store };
  }

  test('OPTIONS プリフライトリクエストはカウントを消費せず通過すること。', async () => {
    const { app } = createTestApp({
      limit: 2,
      action: 'preflight-test',
    });

    for (let i = 0; i < 5; i++) {
      const res = await app.request('/api/test', {
        method: 'OPTIONS',
        headers: { 'cf-connecting-ip': '192.0.2.1' },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(await res.text(), 'options-ok');
    }

    // OPTIONS リクエスト後に POST を送っても枠が満額残っている。
    const postRes = await app.request('/api/test', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '192.0.2.1' },
    });
    assert.strictEqual(postRes.status, 200);
    assert.strictEqual(postRes.headers.get('X-RateLimit-Remaining'), '1');
  });

  test('上限回数までは 200 OK と適切な残存ヘッダーが返却されること。', async () => {
    const { app } = createTestApp({
      limit: 3,
      action: 'limit-headers-test',
    });

    const res1 = await app.request('/api/test', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '192.0.2.10' },
    });
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.headers.get('X-RateLimit-Limit'), '3');
    assert.strictEqual(res1.headers.get('X-RateLimit-Remaining'), '2');
    assert.ok(res1.headers.get('X-RateLimit-Reset') !== null);

    const res2 = await app.request('/api/test', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '192.0.2.10' },
    });
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.headers.get('X-RateLimit-Remaining'), '1');

    const res3 = await app.request('/api/test', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '192.0.2.10' },
    });
    assert.strictEqual(res3.status, 200);
    assert.strictEqual(res3.headers.get('X-RateLimit-Remaining'), '0');
  });

  test('上限超過時に 429 Too Many Requests と Retry-After ヘッダーを返却すること。', async () => {
    const { app } = createTestApp({
      limit: 2,
      action: 'exceeded-test',
    });

    await app.request('/api/test', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '192.0.2.20' },
    });
    await app.request('/api/test', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '192.0.2.20' },
    });

    // 3回目のリクエストで制限遮断。
    const res = await app.request('/api/test', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '192.0.2.20' },
    });

    assert.strictEqual(res.status, 429);
    assert.strictEqual(res.headers.get('X-RateLimit-Remaining'), '0');
    assert.ok(res.headers.get('Retry-After') !== null);

    const body = (await res.json()) as { error: { message: string } };
    assert.strictEqual(body.error.message, RATE_LIMIT_EXCEEDED_MESSAGE);
  });

  test('設定定数 (署名: 10, コミット: 3) の整合性を検証できること。', () => {
    assert.strictEqual(RATE_LIMIT_UPLOAD_SIGN_LIMIT, 10);
    assert.strictEqual(RATE_LIMIT_DOCUMENT_COMMIT_LIMIT, 3);
  });

  test('レートリミット超過時は後続の処理(Turnstile 等)を呼び出さずに即時遮断すること。', async () => {
    const app = new Hono();
    const store = new InMemoryRateLimitStore();
    let downstreamCalled = 0;

    app.post(
      '/api/pipeline-test',
      createRateLimitMiddleware({
        limit: 1,
        action: 'pipeline-test',
        store,
      }),
      async (c, next) => {
        downstreamCalled += 1;
        await next();
      },
      (c) => c.json({ status: 'ok' }, 200),
    );

    const res1 = await app.request('/api/pipeline-test', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '192.0.2.50' },
    });
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(downstreamCalled, 1);

    // 2回目はレートリミットで遮断され、後続ミドルウェアは一切実行されない。
    const res2 = await app.request('/api/pipeline-test', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '192.0.2.50' },
    });
    assert.strictEqual(res2.status, 429);
    assert.strictEqual(downstreamCalled, 1);
  });
});
