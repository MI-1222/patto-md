import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { Hono } from 'hono';
import {
  generateCapabilityToken,
  hashToken,
  type DocumentDeleteResponse,
  type DocumentRenewResponse,
  type DocumentUpdateRequest,
  type DocumentUpdateResponse,
} from '@patto-md/shared';
import { documentsRouter } from '../src/routes/documents.ts';
import type { AppEnv, AuthenticatedDocument } from '../src/types.ts';

describe('ドキュメント更新・削除・再公開ライフサイクルAPI (documentsRouter)', () => {
  const dummySlug = 'AbCdEf123456';
  const validContentKey = 'temp/uploads/valid-uuid/content.md';
  const validImageKey = 'temp/uploads/valid-uuid/image.png';

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
      title: '初期タイトル',
      description: '初期要約',
      content_r2_key: validContentKey,
      status: 'published',
      expires_at: '2026-11-05T00:00:00.000Z',
      edit_token_hash: editTokenHash,
      modify_token_hash: modifyTokenHash,
      owner_user_id: null,
      owner_provider: null,
      visibility: 'public',
      passcode_hash: null,
      created_at: '2026-10-30T00:00:00.000Z',
      updated_at: '2026-10-30T00:00:00.000Z',
      ...overrides,
    };

    return { doc, editToken, modifyToken };
  }

  /** テスト用 Hono アプリケーションを構築する。 */
  function buildTestApp(
    initialDoc: AuthenticatedDocument | null,
    existingR2Keys: string[] = [validContentKey, validImageKey],
  ) {
    const doc = initialDoc ? { ...initialDoc } : null;
    const batchStatements: unknown[][] = [];
    const runStatements: Array<{ query: string; args: unknown[] }> = [];

    const mockDb = {
      prepare: (query: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => {
            if (
              query.includes('FROM documents') &&
              query.includes('WHERE id = ?')
            ) {
              return doc;
            }
            return null;
          },
          run: async () => {
            runStatements.push({ query, args });
            if (
              query.includes('UPDATE documents') &&
              query.includes("status = 'deleted'")
            ) {
              if (doc) doc.status = 'deleted';
            }
            if (
              query.includes('UPDATE documents') &&
              query.includes("status = 'published'")
            ) {
              if (doc) {
                doc.status = 'published';
                doc.expires_at = args[0] as string | null;
              }
            }
            return { success: true };
          },
        }),
      }),
      batch: async (statements: unknown[]) => {
        batchStatements.push(statements);
        return [];
      },
    };

    const keysSet = new Set(existingR2Keys);
    const mockBucket = {
      head: async (key: string) => {
        if (keysSet.has(key)) {
          return { key, size: 1024 };
        }
        return null;
      },
    };

    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.env = {
        ...c.env,
        DB: mockDb as unknown as D1Database,
        BUCKET: mockBucket as unknown as R2Bucket,
      };
      await next();
    });

    app.route('/api/documents', documentsRouter);

    return {
      app,
      getDoc: () => doc,
      getBatchStatements: () => batchStatements,
      getRunStatements: () => runStatements,
    };
  }

  describe('PUT /api/documents/:id (本文・メタデータ更新)', () => {
    test('modifyToken で本文・タイトル・添付ファイルを正常に更新できること。', async () => {
      const { doc, modifyToken } = await createFixtureDoc();
      const { app, getBatchStatements } = buildTestApp(doc);

      const payload: DocumentUpdateRequest = {
        title: '更新後タイトル',
        description: '更新後要約',
        contentR2Key: validContentKey,
        attachments: [
          {
            id: 'att-1',
            fileName: 'image.png',
            fileSize: 1024,
            mimeType: 'image/png',
            r2Key: validImageKey,
          },
        ],
      };

      const res = await app.request(
        `http://localhost/api/documents/${dummySlug}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${modifyToken}`,
          },
          body: JSON.stringify(payload),
        },
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('Cache-Control'), 'no-store');

      const body = (await res.json()) as DocumentUpdateResponse;
      assert.strictEqual(body.id, dummySlug);
      assert.strictEqual(body.title, '更新後タイトル');
      assert.strictEqual(body.description, '更新後要約');
      assert.strictEqual(body.url, `/p/${dummySlug}`);
      assert.strictEqual(typeof body.updatedAt, 'string');

      assert.strictEqual(getBatchStatements().length, 1);
    });

    test('editToken でも包含関係により正常に更新できること。', async () => {
      const { doc, editToken } = await createFixtureDoc();
      const { app } = buildTestApp(doc);

      const payload: DocumentUpdateRequest = {
        title: '特権更新タイトル',
        contentR2Key: validContentKey,
        attachments: [],
      };

      const res = await app.request(
        `http://localhost/api/documents/${dummySlug}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${editToken}`,
          },
          body: JSON.stringify(payload),
        },
      );

      assert.strictEqual(res.status, 200);
      const body = (await res.json()) as DocumentUpdateResponse;
      assert.strictEqual(body.title, '特権更新タイトル');
    });

    test('認証ヘッダー未指定時は 401 を返却すること。', async () => {
      const { doc } = await createFixtureDoc();
      const { app } = buildTestApp(doc);

      const res = await app.request(
        `http://localhost/api/documents/${dummySlug}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: '更新',
            contentR2Key: validContentKey,
          }),
        },
      );

      assert.strictEqual(res.status, 401);
    });

    test('R2 に実体が存在しないキーを指定した場合は 400 を返却すること。', async () => {
      const { doc, modifyToken } = await createFixtureDoc();
      const { app } = buildTestApp(doc, [validImageKey]);

      const payload: DocumentUpdateRequest = {
        title: '更新後タイトル',
        contentR2Key: 'temp/uploads/missing-uuid/content.md',
        attachments: [],
      };

      const res = await app.request(
        `http://localhost/api/documents/${dummySlug}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${modifyToken}`,
          },
          body: JSON.stringify(payload),
        },
      );

      assert.strictEqual(res.status, 400);
      const body = (await res.json()) as { error: { message: string } };
      assert.strictEqual(
        body.error.message,
        '指定された本文ファイルがストレージに存在しません。',
      );
    });

    test('規約違反通報により凍結中 (suspended) のドキュメントは 403 で遮断すること。', async () => {
      const { doc, modifyToken } = await createFixtureDoc({
        status: 'suspended',
      });
      const { app } = buildTestApp(doc);

      const res = await app.request(
        `http://localhost/api/documents/${dummySlug}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${modifyToken}`,
          },
          body: JSON.stringify({
            title: '凍結更新',
            contentR2Key: validContentKey,
            attachments: [],
          }),
        },
      );

      assert.strictEqual(res.status, 403);
      const body = (await res.json()) as { error: { message: string } };
      assert.strictEqual(
        body.error.message,
        '規約違反の通報により凍結されています。',
      );
    });
  });

  describe('DELETE /api/documents/:id (論理削除)', () => {
    test('editToken で正常に論理削除できること。', async () => {
      const { doc, editToken } = await createFixtureDoc();
      const { app, getDoc, getRunStatements } = buildTestApp(doc);

      const res = await app.request(
        `http://localhost/api/documents/${dummySlug}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${editToken}`,
          },
        },
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('Cache-Control'), 'no-store');

      const body = (await res.json()) as DocumentDeleteResponse;
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.id, dummySlug);

      assert.strictEqual(getDoc()?.status, 'deleted');
      assert.strictEqual(getRunStatements().length, 1);
    });

    test('modifyToken では削除権限がなく 403 を返却すること。', async () => {
      const { doc, modifyToken } = await createFixtureDoc();
      const { app, getDoc } = buildTestApp(doc);

      const res = await app.request(
        `http://localhost/api/documents/${dummySlug}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${modifyToken}`,
          },
        },
      );

      assert.strictEqual(res.status, 403);
      assert.strictEqual(getDoc()?.status, 'published');
    });

    test('凍結中 (suspended) のドキュメントであっても、特権 editToken 保持者は自主取り下げ (DELETE) が可能であること。', async () => {
      const { doc, editToken } = await createFixtureDoc({
        status: 'suspended',
      });
      const { app, getDoc } = buildTestApp(doc);

      const res = await app.request(
        `http://localhost/api/documents/${dummySlug}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${editToken}`,
          },
        },
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(getDoc()?.status, 'deleted');
    });
  });

  describe('POST /api/documents/:id/renew (再公開・有効期限延長)', () => {
    test('editToken で有効期限を延長して再公開できること。', async () => {
      const { doc, editToken } = await createFixtureDoc({
        expires_at: '2026-10-01T00:00:00.000Z', // 過去日付
      });
      const { app, getDoc, getRunStatements } = buildTestApp(doc);

      const res = await app.request(
        `http://localhost/api/documents/${dummySlug}/renew`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${editToken}`,
          },
          body: JSON.stringify({
            expiration: '30days',
          }),
        },
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('Cache-Control'), 'no-store');

      const body = (await res.json()) as DocumentRenewResponse;
      assert.strictEqual(body.id, dummySlug);
      assert.strictEqual(body.url, `/p/${dummySlug}`);
      assert.strictEqual(typeof body.expiresAt, 'string');
      assert.strictEqual(typeof body.updatedAt, 'string');

      assert.strictEqual(getDoc()?.status, 'published');
      assert.strictEqual(getRunStatements().length, 1);
    });

    test('無期限 (never) への更新ができること。', async () => {
      const { doc, editToken } = await createFixtureDoc();
      const { app, getDoc } = buildTestApp(doc);

      const res = await app.request(
        `http://localhost/api/documents/${dummySlug}/renew`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${editToken}`,
          },
          body: JSON.stringify({
            expiration: 'never',
          }),
        },
      );

      assert.strictEqual(res.status, 200);
      const body = (await res.json()) as DocumentRenewResponse;
      assert.strictEqual(body.expiresAt, null);
      assert.strictEqual(getDoc()?.expires_at, null);
    });

    test('modifyToken では延長権限がなく 403 を返却すること。', async () => {
      const { doc, modifyToken } = await createFixtureDoc();
      const { app } = buildTestApp(doc);

      const res = await app.request(
        `http://localhost/api/documents/${dummySlug}/renew`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${modifyToken}`,
          },
          body: JSON.stringify({
            expiration: '7days',
          }),
        },
      );

      assert.strictEqual(res.status, 403);
    });

    test('無効な有効期限プリセットでは 400 を返却すること。', async () => {
      const { doc, editToken } = await createFixtureDoc();
      const { app } = buildTestApp(doc);

      const res = await app.request(
        `http://localhost/api/documents/${dummySlug}/renew`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${editToken}`,
          },
          body: JSON.stringify({
            expiration: 'invalid-preset',
          }),
        },
      );

      assert.strictEqual(res.status, 400);
    });

    test('凍結中 (suspended) のドキュメントは 403 で遮断すること。', async () => {
      const { doc, editToken } = await createFixtureDoc({
        status: 'suspended',
      });
      const { app } = buildTestApp(doc);

      const res = await app.request(
        `http://localhost/api/documents/${dummySlug}/renew`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${editToken}`,
          },
          body: JSON.stringify({
            expiration: '7days',
          }),
        },
      );

      assert.strictEqual(res.status, 403);
    });
  });
});
