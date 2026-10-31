import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  generateCapabilityToken,
  hashToken,
  TURNSTILE_TEST_SECRET_KEY_PASS,
  TURNSTILE_TOKEN_HEADER,
} from '@patto-md/shared';
import { Hono } from 'hono';
import {
  copyAndDeleteR2Object,
  extractExpirationPrefix,
  generateR2Key,
  getExpirationPrefix,
  isValidR2Key,
  migrateR2KeyPrefix,
} from '../src/lib/r2.ts';
import { uploadRouter } from '../src/routes/upload.ts';
import { documentsRouter } from '../src/routes/documents.ts';
import type { AppEnv } from '../src/types.ts';

describe('R2 オブジェクトキー設計およびライフサイクルプレフィックス', () => {
  const dummyFileId = '12345678-1234-4234-8234-123456789012';
  const dummyFileName = 'diagram test.png';

  test('有効期限プリセットに応じたプレフィックスが付与されること。', () => {
    assert.strictEqual(
      generateR2Key(dummyFileId, dummyFileName, '1day'),
      `exp-1d/uploads/${dummyFileId}/diagram_test.png`,
    );
    assert.strictEqual(
      generateR2Key(dummyFileId, dummyFileName, '7days'),
      `exp-7d/uploads/${dummyFileId}/diagram_test.png`,
    );
    assert.strictEqual(
      generateR2Key(dummyFileId, dummyFileName, '30days'),
      `exp-30d/uploads/${dummyFileId}/diagram_test.png`,
    );
    assert.strictEqual(
      generateR2Key(dummyFileId, dummyFileName, 'never'),
      `permanent/uploads/${dummyFileId}/diagram_test.png`,
    );
    // デフォルト未指定時は '7days' ('exp-7d/') が適用される。
    assert.strictEqual(
      generateR2Key(dummyFileId, dummyFileName),
      `exp-7d/uploads/${dummyFileId}/diagram_test.png`,
    );
  });

  test('有効期限プレフィックスマッピングの取得が正当であること。', () => {
    assert.strictEqual(getExpirationPrefix('1day'), 'exp-1d/');
    assert.strictEqual(getExpirationPrefix('7days'), 'exp-7d/');
    assert.strictEqual(getExpirationPrefix('30days'), 'exp-30d/');
    assert.strictEqual(getExpirationPrefix('never'), 'permanent/');
  });

  test('R2オブジェクトキーからプレフィックスを抽出できること。', () => {
    assert.strictEqual(
      extractExpirationPrefix('exp-1d/uploads/abc/img.png'),
      'exp-1d/',
    );
    assert.strictEqual(
      extractExpirationPrefix('exp-7d/uploads/abc/img.png'),
      'exp-7d/',
    );
    assert.strictEqual(
      extractExpirationPrefix('exp-30d/uploads/abc/img.png'),
      'exp-30d/',
    );
    assert.strictEqual(
      extractExpirationPrefix('permanent/uploads/abc/img.png'),
      'permanent/',
    );
    assert.strictEqual(
      extractExpirationPrefix('temp/uploads/abc/img.png'),
      null,
    );
    assert.strictEqual(extractExpirationPrefix('uploads/abc/img.png'), null);
  });

  test('プレフィックスの付け替えが正常に動作すること。', () => {
    assert.strictEqual(
      migrateR2KeyPrefix('exp-7d/uploads/abc/img.png', 'exp-30d/'),
      'exp-30d/uploads/abc/img.png',
    );
    assert.strictEqual(
      migrateR2KeyPrefix('temp/uploads/abc/img.png', 'exp-7d/'),
      'exp-7d/uploads/abc/img.png',
    );
    assert.strictEqual(
      migrateR2KeyPrefix('exp-1d/uploads/abc/img.png', 'permanent/'),
      'permanent/uploads/abc/img.png',
    );
  });

  test('`isValidR2Key` が新旧プレフィックスを許容し、不正キーを拒絶すること。', () => {
    // 正当なキー形式。
    assert.strictEqual(isValidR2Key('exp-1d/uploads/abc/file.md'), true);
    assert.strictEqual(isValidR2Key('exp-7d/uploads/abc/image.png'), true);
    assert.strictEqual(isValidR2Key('exp-30d/uploads/abc/image.webp'), true);
    assert.strictEqual(isValidR2Key('permanent/uploads/abc/file.md'), true);
    assert.strictEqual(isValidR2Key('temp/uploads/abc/file.md'), true);
    assert.strictEqual(isValidR2Key('exp-7d/temp/uploads/abc/file.md'), true);

    // パストラバーサルおよび危険文字の拒絶。
    assert.strictEqual(isValidR2Key('../exp-7d/uploads/abc/file.md'), false);
    assert.strictEqual(isValidR2Key('exp-7d/uploads/../file.md'), false);
    assert.strictEqual(isValidR2Key('/exp-7d/uploads/abc/file.md'), false);
    assert.strictEqual(isValidR2Key('exp-7d\\uploads\\abc\\file.md'), false);

    // 未許可プレフィックスの拒絶。
    assert.strictEqual(isValidR2Key('other/uploads/abc/file.md'), false);
    assert.strictEqual(isValidR2Key('exp-99d/uploads/abc/file.md'), false);
    assert.strictEqual(isValidR2Key('uploads/abc/file.md'), false);

    // 空文字や不正な型。
    assert.strictEqual(isValidR2Key(''), false);
    assert.strictEqual(isValidR2Key(null as unknown as string), false);
    assert.strictEqual(isValidR2Key(undefined as unknown as string), false);
  });

  test('`copyAndDeleteR2Object` によるR2コピーおよび削除が正常に行われること。', async () => {
    const r2Store = new Map<
      string,
      { body: string; headers?: Record<string, string> }
    >();
    r2Store.set('exp-7d/uploads/doc/content.md', {
      body: '# Hello Markdown',
      headers: { 'content-type': 'text/markdown' },
    });

    const mockBucket = {
      get: async (key: string) => {
        const item = r2Store.get(key);
        if (!item) return null;
        return {
          body: item.body,
          httpMetadata: { contentType: item.headers?.['content-type'] },
          customMetadata: {},
        };
      },
      put: async (key: string, body: unknown, options?: unknown) => {
        r2Store.set(key, {
          body: body as string,
          headers: {
            'content-type':
              (options as { httpMetadata?: { contentType?: string } })
                ?.httpMetadata?.contentType || '',
          },
        });
      },
      delete: async (key: string) => {
        r2Store.delete(key);
      },
    } as unknown as R2Bucket;

    // 別キーへのコピーと旧キー削除。
    await copyAndDeleteR2Object(
      mockBucket,
      'exp-7d/uploads/doc/content.md',
      'exp-30d/uploads/doc/content.md',
    );

    assert.strictEqual(r2Store.has('exp-7d/uploads/doc/content.md'), false);
    assert.strictEqual(r2Store.has('exp-30d/uploads/doc/content.md'), true);
    assert.strictEqual(
      r2Store.get('exp-30d/uploads/doc/content.md')?.body,
      '# Hello Markdown',
    );

    // 同一キーへの PUT (起算日の更新)。
    await copyAndDeleteR2Object(
      mockBucket,
      'exp-30d/uploads/doc/content.md',
      'exp-30d/uploads/doc/content.md',
    );
    assert.strictEqual(r2Store.has('exp-30d/uploads/doc/content.md'), true);
  });
});

describe('POST /api/upload/sign (有効期限プレフィックス連動)', () => {
  const dummyEnv: Partial<AppEnv['Bindings']> = {
    CLOUDFLARE_ACCOUNT_ID: 'test-account-id',
    R2_ACCESS_KEY_ID: 'test-access-key-id',
    R2_SECRET_ACCESS_KEY: 'test-secret-access-key',
    R2_BUCKET_NAME: 'patto-md-r2',
    TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET_KEY_PASS,
  };

  /** テスト用 Hono アプリケーションを構築する。 */
  function buildUploadTestApp() {
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.env = {
        ...c.env,
        ...dummyEnv,
      } as AppEnv['Bindings'];
      await next();
    });
    app.route('/api/upload', uploadRouter);
    return app;
  }

  test('有効期限未指定時は既定の 7days (exp-7d/) プレフィックスで署名が発行されること。', async () => {
    const app = buildUploadTestApp();
    const res = await app.request('http://localhost/api/upload/sign', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [TURNSTILE_TOKEN_HEADER]: 'dummy-token',
      },
      body: JSON.stringify({
        files: [
          {
            name: 'sample.png',
            size: 1024,
            type: 'image/png',
          },
        ],
      }),
    });

    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as {
      files: Array<{ r2Key: string; uploadUrl: string }>;
    };
    assert.strictEqual(body.files.length, 1);
    assert.match(body.files[0].r2Key, /^exp-7d\/uploads\/[^/]+\/sample\.png$/);
  });

  test('有効期限 `1day` 指定時は `exp-1d/` プレフィックスで署名が発行されること。', async () => {
    const app = buildUploadTestApp();
    const res = await app.request('http://localhost/api/upload/sign', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [TURNSTILE_TOKEN_HEADER]: 'dummy-token',
      },
      body: JSON.stringify({
        expiration: '1day',
        files: [
          {
            name: 'doc.md',
            size: 512,
            type: 'text/markdown',
          },
        ],
      }),
    });

    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { files: Array<{ r2Key: string }> };
    assert.match(body.files[0].r2Key, /^exp-1d\/uploads\/[^/]+\/doc\.md$/);
  });

  test('有効期限 `30days` 指定時は `exp-30d/` プレフィックスで署名が発行されること。', async () => {
    const app = buildUploadTestApp();
    const res = await app.request('http://localhost/api/upload/sign', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [TURNSTILE_TOKEN_HEADER]: 'dummy-token',
      },
      body: JSON.stringify({
        expiration: '30days',
        files: [
          {
            name: 'photo.webp',
            size: 2048,
            type: 'image/webp',
          },
        ],
      }),
    });

    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { files: Array<{ r2Key: string }> };
    assert.match(body.files[0].r2Key, /^exp-30d\/uploads\/[^/]+\/photo\.webp$/);
  });

  test('有効期限 `never` 指定時は `permanent/` プレフィックスで署名が発行されること。', async () => {
    const app = buildUploadTestApp();
    const res = await app.request('http://localhost/api/upload/sign', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [TURNSTILE_TOKEN_HEADER]: 'dummy-token',
      },
      body: JSON.stringify({
        expiration: 'never',
        files: [
          {
            name: 'archive.md',
            size: 1024,
            type: 'text/markdown',
          },
        ],
      }),
    });

    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { files: Array<{ r2Key: string }> };
    assert.match(
      body.files[0].r2Key,
      /^permanent\/uploads\/[^/]+\/archive\.md$/,
    );
  });

  test('不正な有効期限プリセットを指定した場合は 400 Bad Request となること。', async () => {
    const app = buildUploadTestApp();
    const res = await app.request('http://localhost/api/upload/sign', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [TURNSTILE_TOKEN_HEADER]: 'dummy-token',
      },
      body: JSON.stringify({
        expiration: '99days',
        files: [
          {
            name: 'sample.png',
            size: 1024,
            type: 'image/png',
          },
        ],
      }),
    });

    assert.strictEqual(res.status, 400);
  });
});

describe('POST /api/documents (有効期限プレフィックス整合性バリデーション)', () => {
  let ipCounter = 1;
  /** レートリミット回避のため、リクエストごとに異なる IP アドレスを発行する。 */
  const nextIp = () => `198.51.100.${ipCounter++}`;

  /** ドキュメント検証用のテストアプリケーションを構築する。 */
  function buildDocumentsTestApp() {
    const mockDb = {
      prepare: (query: string) => ({
        bind: (...args: unknown[]) => ({ query, args }),
      }),
      batch: async () => [],
    };

    const mockBucket = {
      head: async () => ({ size: 1024 }),
    };

    const app = new Hono<AppEnv>();
    app.route('/api/documents', documentsRouter);

    return {
      app,
      env: {
        DB: mockDb as unknown as D1Database,
        BUCKET: mockBucket as unknown as R2Bucket,
      },
    };
  }

  test('ドキュメントの有効期限と本文プレフィックスが一致している場合は 201 Created となること。', async () => {
    const { app, env } = buildDocumentsTestApp();
    const res = await app.request(
      '/api/documents',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': nextIp(),
        },
        body: JSON.stringify({
          title: 'テストドキュメント',
          contentR2Key: 'exp-7d/uploads/uuid-1/content.md',
          attachments: [
            {
              id: 'att-1',
              fileName: 'diagram.png',
              fileSize: 1024,
              mimeType: 'image/png',
              r2Key: 'exp-7d/uploads/uuid-2/diagram.png',
            },
          ],
          expiration: '7days',
        }),
      },
      env,
    );

    assert.strictEqual(res.status, 201);
  });

  test('旧形式の `temp/uploads/` プレフィックスも後方互換で 201 Created となること。', async () => {
    const { app, env } = buildDocumentsTestApp();
    const res = await app.request(
      '/api/documents',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': nextIp(),
        },
        body: JSON.stringify({
          title: '旧形式ドキュメント',
          contentR2Key: 'temp/uploads/uuid-1/content.md',
          attachments: [],
          expiration: '7days',
        }),
      },
      env,
    );

    assert.strictEqual(res.status, 201);
  });

  test('本文のプレフィックスが有効期限と不一致の場合は 400 Bad Request となること。', async () => {
    const { app, env } = buildDocumentsTestApp();
    const res = await app.request(
      '/api/documents',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': nextIp(),
        },
        body: JSON.stringify({
          title: '不一致ドキュメント',
          contentR2Key: 'exp-30d/uploads/uuid-1/content.md', // '30days' であるが 'expiration' は '7days'。
          attachments: [],
          expiration: '7days',
        }),
      },
      env,
    );

    assert.strictEqual(res.status, 400);
    const body = (await res.json()) as { error: { message: string } };
    assert.match(
      body.error.message,
      /ドキュメントの有効期限と本文ストレージキーの失効プレフィックスが一致しません/,
    );
  });

  test('添付ファイルのプレフィックスが有効期限と不一致の場合は 400 Bad Request となること。', async () => {
    const { app, env } = buildDocumentsTestApp();
    const res = await app.request(
      '/api/documents',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': nextIp(),
        },
        body: JSON.stringify({
          title: '添付不一致ドキュメント',
          contentR2Key: 'exp-7d/uploads/uuid-1/content.md',
          attachments: [
            {
              id: 'att-1',
              fileName: 'diagram.png',
              fileSize: 1024,
              mimeType: 'image/png',
              r2Key: 'exp-1d/uploads/uuid-2/diagram.png', // '1day' であるが 'expiration' は '7days'。
            },
          ],
          expiration: '7days',
        }),
      },
      env,
    );

    assert.strictEqual(res.status, 400);
    const body = (await res.json()) as { error: { message: string } };
    assert.match(
      body.error.message,
      /ストレージキーが有効期限プレフィックスと一致しません/,
    );
  });
});

describe('POST /api/documents/:id/renew (Markdown本文内画像URL置換およびキー移行)', () => {
  test('Renew 時に添付ファイルプレフィックスが変更された際、Markdown本文内の画像URLが一括置換されて保存されること。', async () => {
    const slug = 'AbCdEf123456';
    const rawEditToken = generateCapabilityToken('edit');
    const editTokenHash = await hashToken(rawEditToken);

    const oldContentKey = 'exp-7d/uploads/uuid-doc/content.md';
    const oldImageKey = 'exp-7d/uploads/uuid-img/diagram.png';
    const initialMarkdown = `# 仕様書\n\n![図面](/api/assets/${oldImageKey})\n\n詳細は上記参照。`;

    // R2 メモリストア。
    const r2Store = new Map<string, { body: string; contentType?: string }>();
    r2Store.set(oldContentKey, {
      body: initialMarkdown,
      contentType: 'text/markdown; charset=utf-8',
    });
    r2Store.set(oldImageKey, {
      body: 'fake-png-binary-data',
      contentType: 'image/png',
    });

    const mockBucket = {
      head: async (key: string) => {
        const item = r2Store.get(key);
        if (!item) return null;
        return { key, size: item.body.length };
      },
      get: async (key: string) => {
        const item = r2Store.get(key);
        if (!item) return null;
        return {
          body: item.body,
          text: async () => item.body,
          httpMetadata: { contentType: item.contentType },
          customMetadata: {},
        };
      },
      put: async (key: string, body: unknown, options?: unknown) => {
        r2Store.set(key, {
          body: body as string,
          contentType:
            (options as { httpMetadata?: { contentType?: string } })
              ?.httpMetadata?.contentType || '',
        });
      },
      delete: async (key: string) => {
        r2Store.delete(key);
      },
    };

    let docRecord = {
      id: slug,
      title: 'テストドキュメント',
      description: '説明文',
      content_r2_key: oldContentKey,
      status: 'published',
      expires_at: '2026-10-01T00:00:00.000Z',
      edit_token_hash: editTokenHash,
      modify_token_hash: null,
      owner_user_id: null,
      owner_provider: null,
      visibility: 'public',
      passcode_hash: null,
      created_at: '2026-09-24T00:00:00.000Z',
      updated_at: '2026-09-24T00:00:00.000Z',
    };

    const attachmentRecords = [
      {
        id: 'att-uuid-1',
        document_id: slug,
        file_name: 'diagram.png',
        file_size: 1024,
        mime_type: 'image/png',
        r2_key: oldImageKey,
      },
    ];

    const mockDb = {
      prepare: (query: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => {
            if (query.includes('FROM documents')) {
              return docRecord;
            }
            return null;
          },
          all: async () => {
            if (query.includes('FROM attachments')) {
              return { results: attachmentRecords };
            }
            return { results: [] };
          },
          run: async () => ({ success: true }),
        }),
      }),
      batch: async (statements: unknown[]) => {
        // バッチ実行のシミュレーション。
        return [];
      },
    };

    const app = new Hono<AppEnv>();
    app.route('/api/documents', documentsRouter);

    // '7days' から '30days' ('exp-30d/') への延長を実行。
    const res = await app.request(
      `/api/documents/${slug}/renew`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${rawEditToken}`,
        },
        body: JSON.stringify({
          expiration: '30days',
        }),
      },
      {
        DB: mockDb as unknown as D1Database,
        BUCKET: mockBucket as unknown as R2Bucket,
      },
    );

    assert.strictEqual(res.status, 200);

    const expectedNewContentKey = 'exp-30d/uploads/uuid-doc/content.md';
    const expectedNewImageKey = 'exp-30d/uploads/uuid-img/diagram.png';

    // 1. 新しい本文キーが存在し、旧本文キーが削除されている。
    assert.strictEqual(r2Store.has(expectedNewContentKey), true);
    assert.strictEqual(r2Store.has(oldContentKey), false);

    // 2. 新しい画像キーが存在し、旧画像キーが削除されている。
    assert.strictEqual(r2Store.has(expectedNewImageKey), true);
    assert.strictEqual(r2Store.has(oldImageKey), false);

    // 3. Markdown 本文内の画像 URL が新プレフィックスへ一括置換されている。
    const savedMarkdown = r2Store.get(expectedNewContentKey)?.body;
    assert.ok(savedMarkdown);
    assert.strictEqual(
      savedMarkdown.includes(`/api/assets/${expectedNewImageKey}`),
      true,
    );
    assert.strictEqual(
      savedMarkdown.includes(`/api/assets/${oldImageKey}`),
      false,
    );
  });
});
