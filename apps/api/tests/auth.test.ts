import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { Hono } from 'hono';
import {
  generateCapabilityToken,
  hashToken,
} from '@patto-md/shared/utils/token';
import {
  createDocumentAuthMiddleware,
  extractBearerToken,
} from '../src/lib/auth.ts';
import type { AppEnv, AuthenticatedDocument } from '../src/types.ts';

describe('Bearer トークン抽出処理 (`extractBearerToken`)', () => {
  test('`Bearer` 形式の `Authorization` ヘッダーからトークンを抽出できること。', () => {
    const token = 'pt_edt_test123456789012345678901234567890123456789';
    assert.strictEqual(extractBearerToken(`Bearer ${token}`), token);
  });

  test('大文字小文字を問わず `bearer` プレフィックスを解釈できること。', () => {
    const token = 'pt_mod_test123456789012345678901234567890123456789';
    assert.strictEqual(extractBearerToken(`bearer ${token}`), token);
  });

  test('ヘッダーが未指定または空文字の場合は `null` を返却すること。', () => {
    assert.strictEqual(extractBearerToken(undefined), null);
    assert.strictEqual(extractBearerToken(null), null);
    assert.strictEqual(extractBearerToken(''), null);
  });

  test('`Bearer` 形式以外の認証スキームの場合は `null` を返却すること。', () => {
    assert.strictEqual(extractBearerToken('Basic dXNlcjpwYXNz'), null);
    assert.strictEqual(extractBearerToken('Token abcdef'), null);
    assert.strictEqual(extractBearerToken('Bearer '), null);
  });
});

describe('ドキュメント認可ミドルウェア (`createDocumentAuthMiddleware`)', () => {
  const dummySlug = 'abcdef123456';

  /** テスト用のモックドキュメントレコードを生成する。 */
  async function createFixtureDoc(
    overrides?: Partial<AuthenticatedDocument>,
  ): Promise<{
    doc: AuthenticatedDocument;
    editToken: string;
    modifyToken: string;
  }> {
    const editToken = generateCapabilityToken('edit');
    const modifyToken = generateCapabilityToken('modify');
    const [editTokenHash, modifyTokenHash] = await Promise.all([
      hashToken(editToken),
      hashToken(modifyToken),
    ]);

    const doc: AuthenticatedDocument = {
      id: dummySlug,
      title: 'テスト文書',
      description: '要約テスト',
      content_r2_key: 'contents/test.md',
      status: 'published',
      expires_at: null,
      edit_token_hash: editTokenHash,
      modify_token_hash: modifyTokenHash,
      owner_user_id: null,
      owner_provider: null,
      visibility: 'public',
      passcode_hash: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...overrides,
    };

    return { doc, editToken, modifyToken };
  }

  /** テスト用の Hono アプリケーションを構築する。 */
  function buildTestApp(
    mockDoc: AuthenticatedDocument | null,
    role: 'edit' | 'modify',
  ) {
    const app = new Hono<AppEnv>();

    app.use('/api/documents/:id/*', async (c, next) => {
      c.env = {
        ...c.env,
        DB: {
          prepare: () => ({
            bind: () => ({
              first: async () => mockDoc,
            }),
          }),
        } as unknown as D1Database,
      };
      await next();
    });

    app.post(
      '/api/documents/:id/test-action',
      createDocumentAuthMiddleware(role),
      (c) => {
        const authDoc = c.get('authDoc');
        const tokenRole = c.get('tokenRole');
        return c.json({
          success: true,
          docId: authDoc?.id,
          role: tokenRole,
        });
      },
    );

    return app;
  }

  test('`Authorization` ヘッダー未指定時は 401 を返却すること。', async () => {
    const { doc } = await createFixtureDoc();
    const app = buildTestApp(doc, 'edit');

    const res = await app.request(
      `http://localhost/api/documents/${dummySlug}/test-action`,
      { method: 'POST' },
    );

    assert.strictEqual(res.status, 401);
    const body = (await res.json()) as { error: { message: string } };
    assert.strictEqual(
      body.error.message,
      '認証トークンが指定されていません。',
    );
  });

  test('無効なトークン形式の場合は 401 を返却すること。', async () => {
    const { doc } = await createFixtureDoc();
    const app = buildTestApp(doc, 'edit');

    const res = await app.request(
      `http://localhost/api/documents/${dummySlug}/test-action`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer invalid_format_token' },
      },
    );

    assert.strictEqual(res.status, 401);
    const body = (await res.json()) as { error: { message: string } };
    assert.strictEqual(body.error.message, '無効な認証トークン形式です。');
  });

  test('無効な `Slug` 形式の場合は 400 を返却すること。', async () => {
    const { doc, editToken } = await createFixtureDoc();
    const app = buildTestApp(doc, 'edit');

    const res = await app.request(
      'http://localhost/api/documents/invalid!slug/test-action',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${editToken}` },
      },
    );

    assert.strictEqual(res.status, 400);
    const body = (await res.json()) as { error: { message: string } };
    assert.strictEqual(body.error.message, '無効なドキュメント識別子です。');
  });

  test('ドキュメントが存在しない場合は 404 を返却すること。', async () => {
    const { editToken } = await createFixtureDoc();
    const app = buildTestApp(null, 'edit');

    const res = await app.request(
      `http://localhost/api/documents/${dummySlug}/test-action`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${editToken}` },
      },
    );

    assert.strictEqual(res.status, 404);
    const body = (await res.json()) as { error: { message: string } };
    assert.strictEqual(body.error.message, 'ドキュメントが見つかりません。');
  });

  test('論理削除されたドキュメントへのアクセスは 404 を返却すること。', async () => {
    const { doc, editToken } = await createFixtureDoc({ status: 'deleted' });
    const app = buildTestApp(doc, 'edit');

    const res = await app.request(
      `http://localhost/api/documents/${dummySlug}/test-action`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${editToken}` },
      },
    );

    assert.strictEqual(res.status, 404);
    const body = (await res.json()) as { error: { message: string } };
    assert.strictEqual(body.error.message, 'ドキュメントが見つかりません。');
  });

  test('DB側のハッシュが未設定のレコードに対する操作は 403 で拒絶すること。', async () => {
    const { doc, editToken } = await createFixtureDoc({
      edit_token_hash: null,
      modify_token_hash: null,
    });
    const app = buildTestApp(doc, 'edit');

    const res = await app.request(
      `http://localhost/api/documents/${dummySlug}/test-action`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${editToken}` },
      },
    );

    assert.strictEqual(res.status, 403);
    const body = (await res.json()) as { error: { message: string } };
    assert.strictEqual(body.error.message, '操作を行う権限がありません。');
  });

  test('不一致のトークンでは 403 を返却すること。', async () => {
    const { doc } = await createFixtureDoc();
    const otherToken = generateCapabilityToken('edit');
    const app = buildTestApp(doc, 'edit');

    const res = await app.request(
      `http://localhost/api/documents/${dummySlug}/test-action`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${otherToken}` },
      },
    );

    assert.strictEqual(res.status, 403);
    const body = (await res.json()) as { error: { message: string } };
    assert.strictEqual(body.error.message, '操作を行う権限がありません。');
  });

  test('`edit` 権限要求に対して `editToken` でアクセスした際に 200 で認可されること。', async () => {
    const { doc, editToken } = await createFixtureDoc();
    const app = buildTestApp(doc, 'edit');

    const res = await app.request(
      `http://localhost/api/documents/${dummySlug}/test-action`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${editToken}` },
      },
    );

    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as {
      success: boolean;
      docId: string;
      role: string;
    };
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.docId, dummySlug);
    assert.strictEqual(body.role, 'edit');
  });

  test('`edit` 権限要求に対して `modifyToken` でアクセスした際は 403 で拒絶されること。', async () => {
    const { doc, modifyToken } = await createFixtureDoc();
    const app = buildTestApp(doc, 'edit');

    const res = await app.request(
      `http://localhost/api/documents/${dummySlug}/test-action`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${modifyToken}` },
      },
    );

    assert.strictEqual(res.status, 403);
    const body = (await res.json()) as { error: { message: string } };
    assert.strictEqual(body.error.message, '操作を行う権限がありません。');
  });

  test('`modify` 権限要求に対して `modifyToken` でアクセスした際に 200 で認可されること。', async () => {
    const { doc, modifyToken } = await createFixtureDoc();
    const app = buildTestApp(doc, 'modify');

    const res = await app.request(
      `http://localhost/api/documents/${dummySlug}/test-action`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${modifyToken}` },
      },
    );

    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as {
      success: boolean;
      docId: string;
      role: string;
    };
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.docId, dummySlug);
    assert.strictEqual(body.role, 'modify');
  });

  test('`modify` 権限要求に対して特権 `editToken` でアクセスした際に包含関係で 200 認可されること。', async () => {
    const { doc, editToken } = await createFixtureDoc();
    const app = buildTestApp(doc, 'modify');

    const res = await app.request(
      `http://localhost/api/documents/${dummySlug}/test-action`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${editToken}` },
      },
    );

    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as {
      success: boolean;
      docId: string;
      role: string;
    };
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.docId, dummySlug);
    assert.strictEqual(body.role, 'edit');
  });
});
