/** パスコード保護機能およびアクセス制御の単体テスト。 */

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { Hono } from 'hono';
import {
  generateCapabilityToken,
  hashToken,
  PASSCODE_AUTH_COOKIE_PREFIX,
  type DocumentResponse,
  type DocumentVerifyPasscodeResponse,
} from '@patto-md/shared';
import { hashPasscode, verifyPasscode } from '../src/lib/passcode.ts';
import {
  buildPasscodeSetCookieHeader,
  createViewToken,
  extractViewTokenFromCookie,
  verifyViewToken,
} from '../src/lib/view-token.ts';
import { documentsRouter } from '../src/routes/documents.ts';
import type { AppEnv, AuthenticatedDocument } from '../src/types.ts';

describe('パスコードハッシュ化および定数時間検証 (`passcode.ts`)', () => {
  test('正常にソルト付きPBKDF2ハッシュを生成し、正しいパスコードで照合が成功すること。', async () => {
    const rawPasscode = 'secret-pass-1234';
    const hashed = await hashPasscode(rawPasscode);

    assert.ok(hashed.includes(':'));
    const parts = hashed.split(':');
    assert.equal(parts.length, 2);
    assert.equal(parts[0].length, 32); // 16バイト(32 hex文字)。
    assert.equal(parts[1].length, 64); // 32バイト(64 hex文字)。

    const isValid = await verifyPasscode(rawPasscode, hashed);
    assert.equal(isValid, true);
  });

  test('誤ったパスコードでは照合が失敗すること。', async () => {
    const hashed = await hashPasscode('correct-password');
    const isValid = await verifyPasscode('wrong-password', hashed);
    assert.equal(isValid, false);
  });

  test('不正なハッシュ形式や `null` の場合は安全に `false` を返却すること。', async () => {
    assert.equal(await verifyPasscode('test', null), false);
    assert.equal(await verifyPasscode('test', undefined), false);
    assert.equal(await verifyPasscode('test', 'invalid-format'), false);
    assert.equal(await verifyPasscode('test', '1234:5678'), false);
  });
});

describe('閲覧認証トークン(`JWT`)および `Cookie` 処理 (`view-token.ts`)', () => {
  const dummyDocId = 'AbCdEf123456';
  const dummySecret = 'test-secret-key-12345678901234567890';

  test('閲覧認証JWTの生成と検証が正常に行えること。', async () => {
    const { token, expiresAt } = await createViewToken(
      dummyDocId,
      dummySecret,
      3600,
    );

    assert.ok(token);
    assert.ok(expiresAt);

    const isValid = await verifyViewToken(token, dummyDocId, dummySecret);
    assert.equal(isValid, true);
  });

  test('別ドキュメントID向けのJWTは検証が失敗すること。', async () => {
    const { token } = await createViewToken(dummyDocId, dummySecret, 3600);
    const isValid = await verifyViewToken(
      token,
      'DifferentSlug99',
      dummySecret,
    );
    assert.equal(isValid, false);
  });

  test('期限切れのJWTは検証が失敗すること。', async () => {
    const { token } = await createViewToken(dummyDocId, dummySecret, -10);
    const isValid = await verifyViewToken(token, dummyDocId, dummySecret);
    assert.equal(isValid, false);
  });

  test('Cookieヘッダーからの抽出およびSet-Cookieヘッダー構築が正常に動作すること。', () => {
    const token = 'sample.jwt.token';
    const setCookie = buildPasscodeSetCookieHeader(dummyDocId, token, 86400);

    assert.ok(
      setCookie.includes(`${PASSCODE_AUTH_COOKIE_PREFIX}${dummyDocId}=`),
    );
    assert.ok(setCookie.includes('HttpOnly'));
    assert.ok(setCookie.includes('Secure'));
    assert.ok(setCookie.includes('SameSite=Lax'));

    const cookieHeader = `other=123; ${PASSCODE_AUTH_COOKIE_PREFIX}${dummyDocId}=${token}; extra=abc`;
    const extracted = extractViewTokenFromCookie(cookieHeader, dummyDocId);
    assert.equal(extracted, token);
  });
});

describe('パスコード保護ドキュメントAPIエンドポイント (`documentsRouter`)', () => {
  const protectedSlug = 'ProtDoc12345';
  const rawPasscode = 'my-secret-pass';
  const contentKey = 'temp/uploads/protected-uuid/content.md';
  const contentBody = '# パスコード保護本文\n\n秘匿された情報。';

  /** テスト用 Hono アプリケーションを構築する。 */
  async function buildTestApp() {
    const editToken = generateCapabilityToken('edit');
    const modifyToken = generateCapabilityToken('modify');
    const [editTokenHash, modifyTokenHash, passcodeHash] = await Promise.all([
      hashToken(editToken),
      hashToken(modifyToken),
      hashPasscode(rawPasscode),
    ]);

    const doc: AuthenticatedDocument = {
      id: protectedSlug,
      title: '保護されたタイトル',
      description: '保護された要約',
      content_r2_key: contentKey,
      status: 'published',
      expires_at: '2026-12-31T00:00:00.000Z',
      edit_token_hash: editTokenHash,
      modify_token_hash: modifyTokenHash,
      owner_user_id: null,
      owner_provider: null,
      visibility: 'protected',
      passcode_hash: passcodeHash,
      created_at: '2026-10-30T00:00:00.000Z',
      updated_at: '2026-10-30T00:00:00.000Z',
    };

    const mockDb = {
      prepare: (query: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => {
            if (
              query.includes('FROM documents') &&
              query.includes('WHERE id = ?')
            ) {
              const queryId = args[0] as string;
              if (queryId === protectedSlug) {
                return doc;
              }
            }
            return null;
          },
          all: async () => {
            if (query.includes('FROM attachments')) {
              return { results: [] };
            }
            return { results: [] };
          },
        }),
      }),
    };

    const mockBucket = {
      get: async (key: string) => {
        if (key === contentKey) {
          return {
            text: async () => contentBody,
          };
        }
        return null;
      },
    };

    const app = new Hono<AppEnv>();
    app.route('/api/documents', documentsRouter);

    const env = {
      DB: mockDb as unknown as D1Database,
      BUCKET: mockBucket as unknown as R2Bucket,
      JWT_SECRET: 'test-jwt-secret-for-api-tests-12345',
    };

    return {
      app,
      env,
      editToken,
      modifyToken,
      doc,
    };
  }

  test('未認証で `GET /api/documents/:id` にアクセスした場合、401 Unauthorized と `isProtected: true` が返却され本文が秘匿されること。', async () => {
    const { app, env } = await buildTestApp();

    const res = await app.request(
      `/api/documents/${protectedSlug}`,
      {
        method: 'GET',
      },
      env,
    );

    assert.equal(res.status, 401);
    assert.equal(
      res.headers.get('cache-control'),
      'private, no-cache, no-store',
    );

    const body = (await res.json()) as {
      error: { message: string };
      document: DocumentResponse;
    };
    assert.equal(
      body.error.message,
      'このドキュメントはパスコードで保護されています。',
    );
    assert.equal(body.document.id, protectedSlug);
    assert.equal(body.document.isProtected, true);
    assert.equal(body.document.content, '');
  });

  test('POST /api/documents/:id/verify-passcode で正しいパスコードを入力すると200とCookie(JWT)が発行されること。', async () => {
    const { app, env } = await buildTestApp();

    const res = await app.request(
      `/api/documents/${protectedSlug}/verify-passcode`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ passcode: rawPasscode }),
      },
      env,
    );

    assert.equal(res.status, 200);
    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie);
    assert.ok(
      setCookie.includes(`${PASSCODE_AUTH_COOKIE_PREFIX}${protectedSlug}=`),
    );

    const body = (await res.json()) as DocumentVerifyPasscodeResponse;
    assert.equal(body.success, true);
    assert.ok(body.token);
  });

  test('POST /api/documents/:id/verify-passcode で誤ったパスコードを入力すると401が返却されること。', async () => {
    const { app, env } = await buildTestApp();

    const res = await app.request(
      `/api/documents/${protectedSlug}/verify-passcode`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ passcode: 'wrong-passcode' }),
      },
      env,
    );

    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: { message: string } };
    assert.equal(body.error.message, 'パスコードが一致しません。');
  });

  test('パスコード検証後に発行されたCookieを付与してGETすると、本文が正常に取得できCache-Control: private, no-storeが付与されること。', async () => {
    const { app, env } = await buildTestApp();

    // 1. パスコード照合
    const verifyRes = await app.request(
      `/api/documents/${protectedSlug}/verify-passcode`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ passcode: rawPasscode }),
      },
      env,
    );
    assert.equal(verifyRes.status, 200);
    const { token } =
      (await verifyRes.json()) as DocumentVerifyPasscodeResponse;

    // 2. Cookie を付与して GET
    const getRes = await app.request(
      `/api/documents/${protectedSlug}`,
      {
        method: 'GET',
        headers: {
          Cookie: `${PASSCODE_AUTH_COOKIE_PREFIX}${protectedSlug}=${token}`,
        },
      },
      env,
    );

    assert.equal(getRes.status, 200);
    assert.equal(
      getRes.headers.get('cache-control'),
      'private, no-cache, no-store',
    );
    const docData = (await getRes.json()) as DocumentResponse;
    assert.equal(docData.id, protectedSlug);
    assert.equal(docData.content, contentBody);
    assert.equal(docData.visibility, 'protected');
    assert.equal(docData.isProtected, false);
  });

  test('特権Bearerトークン(editToken)を付与した場合は、パスコードなしで本文取得が認可されること(特権バイパス)。', async () => {
    const { app, env, editToken } = await buildTestApp();

    const res = await app.request(
      `/api/documents/${protectedSlug}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${editToken}`,
        },
      },
      env,
    );

    assert.equal(res.status, 200);
    assert.equal(
      res.headers.get('cache-control'),
      'private, no-cache, no-store',
    );
    const docData = (await res.json()) as DocumentResponse;
    assert.equal(docData.content, contentBody);
  });

  test('GET /api/documents (全体一覧) のクエリに visibility = public 条件が含まれること。', async () => {
    let capturedCountQuery = '';
    let capturedListQuery = '';

    const mockDb = {
      prepare: (query: string) => {
        if (query.includes('COUNT(*)')) {
          capturedCountQuery = query;
        }
        if (query.includes('SELECT') && query.includes('attachment_count')) {
          capturedListQuery = query;
        }
        return {
          bind: () => ({
            first: async () => ({ total: 0 }),
            all: async () => ({ results: [] }),
          }),
        };
      },
    };

    const app = new Hono<AppEnv>();
    app.route('/api/documents', documentsRouter);

    const res = await app.request(
      '/api/documents',
      { method: 'GET' },
      {
        DB: mockDb as unknown as D1Database,
        BUCKET: {} as unknown as R2Bucket,
      },
    );

    assert.equal(res.status, 200);
    assert.ok(capturedCountQuery.includes("d.visibility = 'public'"));
    assert.ok(capturedListQuery.includes("d.visibility = 'public'"));
  });

  test('POST /api/documents で protected と パスコード を指定してコミットすると、D1にハッシュが登録されること。', async () => {
    const validContentKey = 'temp/uploads/valid-uuid/content.md';
    let executedInsertQuery = '';
    let executedBinds: unknown[] = [];

    const mockDb = {
      prepare: (query: string) => ({
        bind: (...args: unknown[]) => ({
          query,
          args,
        }),
      }),
      batch: async (statements: Array<{ query: string; args: unknown[] }>) => {
        executedInsertQuery = statements[0]?.query || '';
        executedBinds = statements[0]?.args || [];
        return [];
      },
    };

    const mockBucket = {
      head: async () => ({ size: 100 }),
    };

    const app = new Hono<AppEnv>();
    app.route('/api/documents', documentsRouter);

    const res = await app.request(
      '/api/documents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: '保護ドキュメント',
          contentR2Key: validContentKey,
          attachments: [],
          expiration: '7days',
          visibility: 'protected',
          passcode: 'test-pass-9999',
        }),
      },
      {
        DB: mockDb as unknown as D1Database,
        BUCKET: mockBucket as unknown as R2Bucket,
      },
    );

    assert.equal(res.status, 201);
    assert.ok(executedInsertQuery.includes('visibility'));
    assert.ok(executedInsertQuery.includes('passcode_hash'));
    assert.equal(executedBinds[7], 'protected'); // visibility
    assert.ok(typeof executedBinds[8] === 'string'); // passcode_hash
    assert.ok((executedBinds[8] as string).includes(':'));
  });

  test('PUT /api/documents/:id で特権トークンを用いて protected と パスコード を更新できること。', async () => {
    const rawEditToken = generateCapabilityToken();
    const editTokenHash = await hashToken(rawEditToken);
    const validContentKey = 'temp/uploads/valid-uuid/content.md';

    let executedUpdateQuery = '';
    let executedUpdateBinds: unknown[] = [];

    const mockDb = {
      prepare: (query: string) => ({
        bind: (...args: unknown[]) => {
          if (
            query.includes('FROM documents') &&
            query.includes('WHERE id = ?')
          ) {
            return {
              first: async () => ({
                id: 'ProtDoc12345',
                title: '既存ドキュメント',
                description: null,
                content_r2_key: validContentKey,
                edit_token_hash: editTokenHash,
                modify_token_hash: null,
                status: 'published',
                expires_at: new Date(Date.now() + 3600000).toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                visibility: 'public',
                passcode_hash: null,
              }),
            };
          }
          return {
            query,
            args,
          };
        },
      }),
      batch: async (statements: Array<{ query: string; args: unknown[] }>) => {
        executedUpdateQuery = statements[0]?.query || '';
        executedUpdateBinds = statements[0]?.args || [];
        return [];
      },
    };

    const mockBucket = {
      head: async () => ({ size: 100 }),
    };

    const app = new Hono<AppEnv>();
    app.route('/api/documents', documentsRouter);

    const res = await app.request(
      '/api/documents/ProtDoc12345',
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${rawEditToken}`,
        },
        body: JSON.stringify({
          title: '保護へ変更',
          contentR2Key: validContentKey,
          attachments: [],
          visibility: 'protected',
          passcode: 'updated-pass-5678',
        }),
      },
      {
        DB: mockDb as unknown as D1Database,
        BUCKET: mockBucket as unknown as R2Bucket,
      },
    );

    assert.equal(res.status, 200);
    assert.ok(executedUpdateQuery.includes('visibility = ?'));
    assert.ok(executedUpdateQuery.includes('passcode_hash = ?'));
    assert.equal(executedUpdateBinds[3], 'protected'); // visibility
    assert.ok(typeof executedUpdateBinds[4] === 'string'); // passcode_hash
    assert.ok((executedUpdateBinds[4] as string).includes(':'));
  });
});
