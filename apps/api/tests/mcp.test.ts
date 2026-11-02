import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  generatePat,
  hashPat,
  type UserApiTokenRecord,
} from '@patto-md/shared';
import { Hono } from 'hono';
import { hashPasscode } from '../src/lib/passcode.ts';
import { mcpRouter } from '../src/routes/mcp.ts';
import type { AppEnv, AuthenticatedDocument } from '../src/types.ts';

/** テスト用 PAT トークン(正規仕様のBase62 43文字エントロピー)。 */
const TEST_VALID_PAT_ALL = generatePat();
const TEST_VALID_PAT_READ_ONLY = generatePat();
const TEST_VALID_PAT_USER_B = generatePat();

/** テスト用ユーザー識別子。 */
const USER_A_ID = 'github:123456';
const USER_B_ID = 'github:999999';

/** テスト用 R2 モックストレージ。 */
function createMockR2Bucket() {
  const store = new Map<
    string,
    { body: string | Uint8Array; contentType?: string }
  >();

  return {
    _store: store,
    async head(key: string) {
      if (store.has(key)) {
        return { key };
      }
      return null;
    },
    async get(key: string) {
      const item = store.get(key);
      if (!item) {
        return null;
      }
      return {
        key,
        text: async () =>
          typeof item.body === 'string'
            ? item.body
            : new TextDecoder().decode(item.body),
        arrayBuffer: async () => {
          if (typeof item.body === 'string') {
            return new TextEncoder().encode(item.body).buffer;
          }
          return item.body.buffer;
        },
      };
    },
    async put(
      key: string,
      value: string | ArrayBuffer | ArrayBufferView,
      options?: { httpMetadata?: { contentType?: string } },
    ) {
      let body: string | Uint8Array;
      if (typeof value === 'string') {
        body = value;
      } else if (value instanceof Uint8Array) {
        body = value;
      } else if (value instanceof ArrayBuffer) {
        body = new Uint8Array(value);
      } else {
        body = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      }
      store.set(key, {
        body,
        contentType: options?.httpMetadata?.contentType,
      });
      return { key };
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

/** テスト用 D1 モックデータベース。 */
function createMockD1Database(
  tokens: UserApiTokenRecord[] = [],
  initialDocs: AuthenticatedDocument[] = [],
) {
  const tokenStore = [...tokens];
  const docStore = [...initialDocs];
  const attachmentStore: Array<{
    id: string;
    document_id: string;
    file_name: string;
    file_size: number;
    mime_type: string;
    r2_key: string;
    created_at: string;
  }> = [];

  return {
    _tokenStore: tokenStore,
    _docStore: docStore,
    _attachmentStore: attachmentStore,

    prepare(query: string) {
      const sqlNormalized = query.replace(/\s+/g, ' ').trim();
      let boundParams: unknown[] = [];

      const stmt = {
        _query: sqlNormalized,
        _boundParams: boundParams,

        bind(...params: unknown[]) {
          boundParams = params;
          stmt._boundParams = params;
          return this;
        },

        async first<T = unknown>(): Promise<T | null> {
          // PAT ハッシュ照合クエリ。
          if (
            sqlNormalized.includes('FROM user_api_tokens WHERE token_hash = ?')
          ) {
            const hash = boundParams[0] as string;
            const found = tokenStore.find((t) => t.token_hash === hash);
            return (found as unknown as T) ?? null;
          }

          // ドキュメント取得クエリ。
          if (sqlNormalized.includes('FROM documents WHERE id = ?')) {
            const id = boundParams[0] as string;
            const found = docStore.find((d) => d.id === id);
            return (found as unknown as T) ?? null;
          }

          return null;
        },

        async all<T = unknown>(): Promise<{ results: T[] }> {
          // 添付ファイル取得クエリ。
          if (
            sqlNormalized.includes('FROM attachments WHERE document_id = ?')
          ) {
            const docId = boundParams[0] as string;
            const list = attachmentStore.filter((a) => a.document_id === docId);
            return { results: list as unknown as T[] };
          }

          return { results: [] };
        },

        async run(): Promise<{ success: boolean }> {
          // last_used_at 更新。
          if (
            sqlNormalized.includes(
              'UPDATE user_api_tokens SET last_used_at = ?',
            )
          ) {
            const lastUsedAt = boundParams[0] as string;
            const id = boundParams[1] as string;
            const token = tokenStore.find((t) => t.id === id);
            if (token) {
              token.last_used_at = lastUsedAt;
            }
            return { success: true };
          }

          // ドキュメント更新。
          if (sqlNormalized.includes('UPDATE documents SET')) {
            const [
              title,
              description,
              visibility,
              passcodeHash,
              updatedAt,
              id,
            ] = boundParams as [
              string,
              string | null,
              string,
              string | null,
              string,
              string,
            ];
            const doc = docStore.find((d) => d.id === id);
            if (doc) {
              doc.title = title;
              doc.description = description;
              doc.visibility =
                visibility as AuthenticatedDocument['visibility'];
              doc.passcode_hash = passcodeHash;
              doc.updated_at = updatedAt;
            }
            return { success: true };
          }

          return { success: true };
        },
      };

      return stmt;
    },

    async batch(
      statements: Array<{ _query: string; _boundParams: unknown[] }>,
    ) {
      for (const statement of statements) {
        const params = statement._boundParams || [];
        const sql = statement._query || '';

        if (sql.includes('INSERT INTO documents')) {
          const [
            id,
            title,
            description,
            content_r2_key,
            expires_at,
            edit_token_hash,
            modify_token_hash,
            visibility,
            passcode_hash,
            owner_user_id,
            owner_provider,
            created_at,
            updated_at,
          ] = params as [
            string,
            string,
            string | null,
            string,
            string | null,
            string | null,
            string | null,
            string,
            string | null,
            string | null,
            string | null,
            string,
            string,
          ];

          docStore.push({
            id,
            title,
            description,
            content_r2_key,
            status: 'published',
            expires_at,
            edit_token_hash,
            modify_token_hash,
            visibility: visibility as AuthenticatedDocument['visibility'],
            passcode_hash,
            owner_user_id,
            owner_provider:
              owner_provider as AuthenticatedDocument['owner_provider'],
            created_at,
            updated_at,
          });
        } else if (sql.includes('INSERT INTO attachments')) {
          const [
            id,
            document_id,
            file_name,
            file_size,
            mime_type,
            r2_key,
            created_at,
          ] = params as [
            string,
            string,
            string,
            number,
            string,
            string,
            string,
          ];

          attachmentStore.push({
            id,
            document_id,
            file_name,
            file_size,
            mime_type,
            r2_key,
            created_at,
          });
        } else if (sql.includes('UPDATE documents SET')) {
          const [title, description, visibility, passcodeHash, updatedAt, id] =
            params as [
              string,
              string | null,
              string,
              string | null,
              string,
              string,
            ];
          const doc = docStore.find((d) => d.id === id);
          if (doc) {
            doc.title = title;
            doc.description = description;
            doc.visibility = visibility as AuthenticatedDocument['visibility'];
            doc.passcode_hash = passcodeHash;
            doc.updated_at = updatedAt;
          }
        } else if (sql.includes('DELETE FROM attachments WHERE id = ?')) {
          const [attId] = params as [string];
          const idx = attachmentStore.findIndex((a) => a.id === attId);
          if (idx !== -1) {
            attachmentStore.splice(idx, 1);
          }
        }
      }
      return [];
    },
  };
}

/** テスト用 Hono アプリケーションを構築する。 */
function createTestApp(
  mockDb: ReturnType<typeof createMockD1Database>,
  mockR2: ReturnType<typeof createMockR2Bucket>,
) {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    c.env = {
      ...c.env,
      DB: mockDb as unknown as D1Database,
      BUCKET: mockR2 as unknown as R2Bucket,
      FRONTEND_ORIGIN: 'https://test.patto-md.com',
    };
    await next();
  });

  app.route('/api/mcp', mcpRouter);
  app.route('/mcp', mcpRouter);

  return app;
}

describe('MCP エンドポイント認証および HTTP レベル検証', () => {
  let app: Hono<AppEnv>;

  test('テスト用データベースとアプリの初期化。', async () => {
    const tokenAllHash = await hashPat(TEST_VALID_PAT_ALL);
    const mockDb = createMockD1Database([
      {
        id: 'token-1',
        user_id: USER_A_ID,
        name: 'Claude Desktop',
        token_hash: tokenAllHash,
        token_last4: '2345',
        scopes: '["documents:read","documents:write"]',
        expires_at: null,
        last_used_at: null,
        created_at: new Date().toISOString(),
      },
    ]);
    const mockR2 = createMockR2Bucket();
    app = createTestApp(mockDb, mockR2);
  });

  test('認証ヘッダーなしの `POST` で 401 Unauthorized を返却すること。', async () => {
    const res = await app.request('/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
      }),
    });

    assert.strictEqual(res.status, 401);
    const body = (await res.json()) as { error: { message: string } };
    assert.strictEqual(body.error.message.includes('PATトークン'), true);
  });

  test('無効なトークンでの `POST` で 401 Unauthorized を返却すること。', async () => {
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer pmd_pat_invalidinvalidinvalidinvalidinvalid12',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
      }),
    });

    assert.strictEqual(res.status, 401);
  });

  test('`GET` リクエストに対して 405 Method Not Allowed を返却すること。', async () => {
    const res = await app.request('/api/mcp', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${TEST_VALID_PAT_ALL}`,
      },
    });

    assert.strictEqual(res.status, 405);
  });
});

describe('MCP プロトコル・ハンドシェイクおよびツール一覧検証', () => {
  let app: Hono<AppEnv>;

  test('セットアップと初期化。', async () => {
    const tokenAllHash = await hashPat(TEST_VALID_PAT_ALL);
    const mockDb = createMockD1Database([
      {
        id: 'token-1',
        user_id: USER_A_ID,
        name: 'Cursor IDE',
        token_hash: tokenAllHash,
        token_last4: '2345',
        scopes: '["documents:read","documents:write"]',
        expires_at: null,
        last_used_at: null,
        created_at: new Date().toISOString(),
      },
    ]);
    const mockR2 = createMockR2Bucket();
    app = createTestApp(mockDb, mockR2);
  });

  test('`initialize` リクエストで 200 とサーバーケイパビリティが返却されること。', async () => {
    const res = await app.request('/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_VALID_PAT_ALL}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0' },
        },
      }),
    });

    assert.strictEqual(res.status, 200);
    const json = (await res.json()) as {
      result: { serverInfo: { name: string }; protocolVersion: string };
    };
    assert.strictEqual(json.result.serverInfo.name, 'patto-md');
  });

  test('`tools/list` リクエストで `publish_document`, `update_document`, `get_document`, `whoami` が返却されること。', async () => {
    const res = await app.request('/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_VALID_PAT_ALL}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      }),
    });

    assert.strictEqual(res.status, 200);
    const json = (await res.json()) as {
      result: { tools: Array<{ name: string; description: string }> };
    };

    const toolNames = json.result.tools.map((t) => t.name);
    assert.strictEqual(toolNames.includes('publish_document'), true);
    assert.strictEqual(toolNames.includes('update_document'), true);
    assert.strictEqual(toolNames.includes('get_document'), true);
    assert.strictEqual(toolNames.includes('whoami'), true);
  });

  test('`whoami` ツールを呼び出してユーザーID、トークン名、認可スコープが返却されること。', async () => {
    const res = await app.request('/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_VALID_PAT_ALL}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'whoami',
          arguments: {},
        },
      }),
    });

    assert.strictEqual(res.status, 200);
    const json = (await res.json()) as {
      result: { content: Array<{ type: string; text: string }>; isError?: boolean };
    };

    assert.strictEqual(json.result.isError, undefined);
    const text = json.result.content[0].text;
    assert.strictEqual(text.includes(USER_A_ID), true);
    assert.strictEqual(text.includes('Cursor IDE'), true);
    assert.strictEqual(text.includes('documents:read'), true);
    assert.strictEqual(text.includes('documents:write'), true);
  });
});

describe('MCP publish_document ツール', () => {
  let app: Hono<AppEnv>;
  let mockDb: ReturnType<typeof createMockD1Database>;
  let mockR2: ReturnType<typeof createMockR2Bucket>;

  test('セットアップ。', async () => {
    const tokenAllHash = await hashPat(TEST_VALID_PAT_ALL);
    const tokenReadOnlyHash = await hashPat(TEST_VALID_PAT_READ_ONLY);

    mockDb = createMockD1Database([
      {
        id: 'token-write',
        user_id: USER_A_ID,
        name: 'Claude Desktop',
        token_hash: tokenAllHash,
        token_last4: '2345',
        scopes: '["documents:read","documents:write"]',
        expires_at: null,
        last_used_at: null,
        created_at: new Date().toISOString(),
      },
      {
        id: 'token-read-only',
        user_id: USER_A_ID,
        name: 'Reader',
        token_hash: tokenReadOnlyHash,
        token_last4: '2345',
        scopes: '["documents:read"]',
        expires_at: null,
        last_used_at: null,
        created_at: new Date().toISOString(),
      },
    ]);
    mockR2 = createMockR2Bucket();
    app = createTestApp(mockDb, mockR2);
  });

  test('テキストのみの Markdown を正常に公開できること。', async () => {
    const res = await app.request('/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_VALID_PAT_ALL}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'publish_document',
          arguments: {
            title: 'MCP テストドキュメント',
            content: '# MCP タイトル\nこれはテスト本文です。',
            description: 'MCP 要約です。',
            expiration: '7days',
            visibility: 'unlisted',
          },
        },
      }),
    });

    assert.strictEqual(res.status, 200);
    const json = (await res.json()) as {
      result: {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
    };

    assert.strictEqual(json.result.isError, undefined);
    const replyText = json.result.content[0].text;
    assert.strictEqual(
      replyText.includes('ドキュメントを正常に公開しました。'),
      true,
    );
    assert.strictEqual(replyText.includes('MCP テストドキュメント'), true);
    assert.strictEqual(
      replyText.includes('https://test.patto-md.com/p/'),
      true,
    );

    // D1 レコードの確認。
    assert.strictEqual(mockDb._docStore.length, 1);
    const createdDoc = mockDb._docStore[0];
    assert.strictEqual(createdDoc.title, 'MCP テストドキュメント');
    assert.strictEqual(createdDoc.owner_user_id, '123456');
    assert.strictEqual(createdDoc.owner_provider, 'github');
    assert.strictEqual(createdDoc.visibility, 'unlisted');

    // R2 本文の確認。
    const r2Content = await mockR2.get(createdDoc.content_r2_key);
    assert.notStrictEqual(r2Content, null);
    const r2Text = await r2Content!.text();
    assert.strictEqual(r2Text, '# MCP タイトル\nこれはテスト本文です。');
  });

  test('添付画像付きの Markdown を公開し、本文内パスが置換されること。', async () => {
    const sampleImageBase64 =
      Buffer.from('FakeImageDataPNG').toString('base64');

    const res = await app.request('/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_VALID_PAT_ALL}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'publish_document',
          arguments: {
            title: '画像付きドキュメント',
            content: '# 構成図\n![構成](./images/arch.png)\n完了。',
            images: [
              {
                path: './images/arch.png',
                base64Data: sampleImageBase64,
                mimeType: 'image/png',
              },
            ],
          },
        },
      }),
    });

    assert.strictEqual(res.status, 200);
    const json = (await res.json()) as {
      result: {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
    };
    assert.strictEqual(json.result.isError, undefined);

    // 添付ファイルが保存されていること。
    assert.strictEqual(mockDb._attachmentStore.length, 1);
    const attachment = mockDb._attachmentStore[0];
    assert.strictEqual(attachment.file_name, 'arch.png');
    assert.strictEqual(attachment.mime_type, 'image/png');

    // R2 に画像が保存されていること。
    const imgObj = await mockR2.get(attachment.r2_key);
    assert.notStrictEqual(imgObj, null);

    // 本文内の画像パスが /api/assets/ に置換されていること。
    const doc = mockDb._docStore[mockDb._docStore.length - 1];
    const r2Text = await (await mockR2.get(doc.content_r2_key))!.text();
    assert.strictEqual(
      r2Text.includes(`/api/assets/${attachment.r2_key}`),
      true,
    );
  });

  test('`documents:write` スコープを持たないトークンではエラーになること。', async () => {
    const res = await app.request('/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_VALID_PAT_READ_ONLY}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: {
          name: 'publish_document',
          arguments: {
            title: 'スコープ不足テスト',
            content: '本文',
          },
        },
      }),
    });

    assert.strictEqual(res.status, 200);
    const json = (await res.json()) as {
      result: {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
    };
    assert.strictEqual(json.result.isError, true);
    assert.strictEqual(
      json.result.content[0].text.includes('documents:write'),
      true,
    );
  });

  test('`visibility: protected` 指定時にパスコードが未指定の場合はエラーになること。', async () => {
    const res = await app.request('/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_VALID_PAT_ALL}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/call',
        params: {
          name: 'publish_document',
          arguments: {
            title: 'パスコード未指定保護テスト',
            content: '保護本文',
            visibility: 'protected',
          },
        },
      }),
    });

    assert.strictEqual(res.status, 200);
    const json = (await res.json()) as {
      result: {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
    };
    assert.strictEqual(json.result.isError, true);
    assert.strictEqual(
      json.result.content[0].text.includes('パスコード'),
      true,
    );
  });
});

describe('MCP get_document ツール', () => {
  let app: Hono<AppEnv>;
  let mockDb: ReturnType<typeof createMockD1Database>;
  let mockR2: ReturnType<typeof createMockR2Bucket>;

  const DOC_PUBLIC_ID = 'slugPublic01';
  const DOC_PROTECTED_ID = 'slugProtect1';
  const DOC_SUSPENDED_ID = 'slugSuspend1';

  test('セットアップ。', async () => {
    const tokenAllHash = await hashPat(TEST_VALID_PAT_ALL);
    const tokenUserBHash = await hashPat(TEST_VALID_PAT_USER_B);
    const passcodeHash = await hashPasscode('secretPass123');

    mockDb = createMockD1Database(
      [
        {
          id: 'token-a',
          user_id: USER_A_ID,
          name: 'User A PAT',
          token_hash: tokenAllHash,
          token_last4: '2345',
          scopes: '["documents:read","documents:write"]',
          expires_at: null,
          last_used_at: null,
          created_at: new Date().toISOString(),
        },
        {
          id: 'token-b',
          user_id: USER_B_ID,
          name: 'User B PAT',
          token_hash: tokenUserBHash,
          token_last4: '6789',
          scopes: '["documents:read","documents:write"]',
          expires_at: null,
          last_used_at: null,
          created_at: new Date().toISOString(),
        },
      ],
      [
        {
          id: DOC_PUBLIC_ID,
          title: '公開ドキュメント',
          description: '公開要約',
          content_r2_key: 'exp-7d/uploads/uuid-pub/content.md',
          status: 'published',
          expires_at: null,
          edit_token_hash: null,
          modify_token_hash: null,
          visibility: 'public',
          passcode_hash: null,
          owner_user_id: '123456',
          owner_provider: 'github',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: DOC_PROTECTED_ID,
          title: '保護ドキュメント',
          description: '保護要約',
          content_r2_key: 'exp-7d/uploads/uuid-prot/content.md',
          status: 'published',
          expires_at: null,
          edit_token_hash: null,
          modify_token_hash: null,
          visibility: 'protected',
          passcode_hash: passcodeHash,
          owner_user_id: '123456',
          owner_provider: 'github',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: DOC_SUSPENDED_ID,
          title: '凍結ドキュメント',
          description: '凍結要約',
          content_r2_key: 'exp-7d/uploads/uuid-susp/content.md',
          status: 'suspended',
          expires_at: null,
          edit_token_hash: null,
          modify_token_hash: null,
          visibility: 'public',
          passcode_hash: null,
          owner_user_id: '123456',
          owner_provider: 'github',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    );

    mockR2 = createMockR2Bucket();
    await mockR2.put(
      'exp-7d/uploads/uuid-pub/content.md',
      '# 公開ドキュメント本文\n内容です。',
    );
    await mockR2.put(
      'exp-7d/uploads/uuid-prot/content.md',
      '# 保護ドキュメント機密本文\n秘密情報です。',
    );

    app = createTestApp(mockDb, mockR2);
  });

  test('公開ドキュメントを正常に取得できること。', async () => {
    const res = await app.request('/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_VALID_PAT_ALL}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 20,
        method: 'tools/call',
        params: {
          name: 'get_document',
          arguments: {
            id: DOC_PUBLIC_ID,
          },
        },
      }),
    });

    assert.strictEqual(res.status, 200);
    const json = (await res.json()) as {
      result: {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
    };

    assert.strictEqual(json.result.isError, undefined);
    const text = json.result.content[0].text;
    assert.strictEqual(text.includes('# 公開ドキュメント'), true);
    assert.strictEqual(text.includes('公開ドキュメント本文'), true);
  });

  test('保護ドキュメントを所有者本人がパスコードなしで取得できること(バイパス)。', async () => {
    const res = await app.request('/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_VALID_PAT_ALL}`, // User A は所有者
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 21,
        method: 'tools/call',
        params: {
          name: 'get_document',
          arguments: {
            id: DOC_PROTECTED_ID,
          },
        },
      }),
    });

    assert.strictEqual(res.status, 200);
    const json = (await res.json()) as {
      result: {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
    };
    assert.strictEqual(json.result.isError, undefined);
    assert.strictEqual(
      json.result.content[0].text.includes('秘密情報です。'),
      true,
    );
  });

  test('第三者がパスコード未指定で保護ドキュメントを取得しようとした場合エラーになること。', async () => {
    const res = await app.request('/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_VALID_PAT_USER_B}`, // User B は第三者
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 22,
        method: 'tools/call',
        params: {
          name: 'get_document',
          arguments: {
            id: DOC_PROTECTED_ID,
          },
        },
      }),
    });

    assert.strictEqual(res.status, 200);
    const json = (await res.json()) as {
      result: {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
    };
    assert.strictEqual(json.result.isError, true);
    assert.strictEqual(
      json.result.content[0].text.includes('パスコードで保護'),
      true,
    );
  });

  test('第三者が正しいパスコードを指定して保護ドキュメントを取得できること。', async () => {
    const res = await app.request('/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_VALID_PAT_USER_B}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 23,
        method: 'tools/call',
        params: {
          name: 'get_document',
          arguments: {
            id: DOC_PROTECTED_ID,
            passcode: 'secretPass123',
          },
        },
      }),
    });

    assert.strictEqual(res.status, 200);
    const json = (await res.json()) as {
      result: {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
    };
    assert.strictEqual(json.result.isError, undefined);
    assert.strictEqual(
      json.result.content[0].text.includes('秘密情報です。'),
      true,
    );
  });

  test('凍結ドキュメントの取得が拒絶されること。', async () => {
    const res = await app.request('/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_VALID_PAT_ALL}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 24,
        method: 'tools/call',
        params: {
          name: 'get_document',
          arguments: {
            id: DOC_SUSPENDED_ID,
          },
        },
      }),
    });

    assert.strictEqual(res.status, 200);
    const json = (await res.json()) as {
      result: {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
    };
    assert.strictEqual(json.result.isError, true);
    assert.strictEqual(json.result.content[0].text.includes('凍結'), true);
  });
});

describe('MCP update_document ツール', () => {
  let app: Hono<AppEnv>;
  let mockDb: ReturnType<typeof createMockD1Database>;
  let mockR2: ReturnType<typeof createMockR2Bucket>;

  const TARGET_DOC_ID = 'slugUpdate01';

  test('セットアップ。', async () => {
    const tokenAllHash = await hashPat(TEST_VALID_PAT_ALL);
    const tokenUserBHash = await hashPat(TEST_VALID_PAT_USER_B);

    mockDb = createMockD1Database(
      [
        {
          id: 'token-a',
          user_id: USER_A_ID,
          name: 'User A',
          token_hash: tokenAllHash,
          token_last4: '2345',
          scopes: '["documents:read","documents:write"]',
          expires_at: null,
          last_used_at: null,
          created_at: new Date().toISOString(),
        },
        {
          id: 'token-b',
          user_id: USER_B_ID,
          name: 'User B',
          token_hash: tokenUserBHash,
          token_last4: '6789',
          scopes: '["documents:read","documents:write"]',
          expires_at: null,
          last_used_at: null,
          created_at: new Date().toISOString(),
        },
      ],
      [
        {
          id: TARGET_DOC_ID,
          title: '更新前タイトル',
          description: '更新前概要',
          content_r2_key: 'exp-7d/uploads/uuid-up/content.md',
          status: 'published',
          expires_at: null,
          edit_token_hash: null,
          modify_token_hash: null,
          visibility: 'unlisted',
          passcode_hash: null,
          owner_user_id: '123456',
          owner_provider: 'github',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    );

    mockR2 = createMockR2Bucket();
    await mockR2.put('exp-7d/uploads/uuid-up/content.md', '# 旧本文');

    app = createTestApp(mockDb, mockR2);
  });

  test('所有者本人が本文とタイトルを正常に更新できること。', async () => {
    const res = await app.request('/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_VALID_PAT_ALL}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 30,
        method: 'tools/call',
        params: {
          name: 'update_document',
          arguments: {
            id: TARGET_DOC_ID,
            title: '更新後タイトル',
            content: '# 更新後本文\n新しくなりました。',
          },
        },
      }),
    });

    assert.strictEqual(res.status, 200);
    const json = (await res.json()) as {
      result: {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
    };
    assert.strictEqual(json.result.isError, undefined);
    assert.strictEqual(
      json.result.content[0].text.includes('正常に更新しました'),
      true,
    );

    // R2 本文が書き換わっていること。
    const r2Text = await (await mockR2.get(
      'exp-7d/uploads/uuid-up/content.md',
    ))!.text();
    assert.strictEqual(r2Text, '# 更新後本文\n新しくなりました。');

    // D1 タイトルが更新されていること。
    const doc = mockDb._docStore.find((d) => d.id === TARGET_DOC_ID);
    assert.strictEqual(doc?.title, '更新後タイトル');
  });

  test('本文更新により参照されなくなった古い添付ファイルレコードが削除され、継続参照されるレコードは保持されること。', async () => {
    // 既存の添付レコードを2件登録 (1件は継続参照、1件は本文から削除)
    mockDb._attachmentStore.push(
      {
        id: 'att-kept',
        document_id: TARGET_DOC_ID,
        file_name: 'kept.png',
        file_size: 1024,
        mime_type: 'image/png',
        r2_key: 'exp-7d/uploads/uuid-up/kept.png',
        created_at: new Date().toISOString(),
      },
      {
        id: 'att-removed',
        document_id: TARGET_DOC_ID,
        file_name: 'removed.png',
        file_size: 2048,
        mime_type: 'image/png',
        r2_key: 'exp-7d/uploads/uuid-up/removed.png',
        created_at: new Date().toISOString(),
      },
    );

    // kept.png のみを含み、removed.png を含まない本文で更新
    const res = await app.request('/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_VALID_PAT_ALL}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 301,
        method: 'tools/call',
        params: {
          name: 'update_document',
          arguments: {
            id: TARGET_DOC_ID,
            content:
              '# 更新ドキュメント\n\n![継続画像](/api/assets/exp-7d/uploads/uuid-up/kept.png)',
          },
        },
      }),
    });

    assert.strictEqual(res.status, 200);

    // 添付ファイルテーブルの検証
    const remainingAttIds = mockDb._attachmentStore
      .filter((a) => a.document_id === TARGET_DOC_ID)
      .map((a) => a.id);

    assert.strictEqual(remainingAttIds.includes('att-kept'), true);
    assert.strictEqual(remainingAttIds.includes('att-removed'), false);
  });

  test('他人の PAT で更新しようとした場合に IDOR 防御により拒絶されること。', async () => {
    const res = await app.request('/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_VALID_PAT_USER_B}`, // User B は所有者ではない
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 31,
        method: 'tools/call',
        params: {
          name: 'update_document',
          arguments: {
            id: TARGET_DOC_ID,
            content: '# 不正改ざん本文',
          },
        },
      }),
    });

    assert.strictEqual(res.status, 200);
    const json = (await res.json()) as {
      result: {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
    };
    assert.strictEqual(json.result.isError, true);
    assert.strictEqual(
      json.result.content[0].text.includes('所有者が一致しません'),
      true,
    );
  });

  test('`visibility: protected` への変更時にパスコードが未指定の場合はエラーになること。', async () => {
    const res = await app.request('/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_VALID_PAT_ALL}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 32,
        method: 'tools/call',
        params: {
          name: 'update_document',
          arguments: {
            id: TARGET_DOC_ID,
            content: '# 更新本文',
            visibility: 'protected',
          },
        },
      }),
    });

    assert.strictEqual(res.status, 200);
    const json = (await res.json()) as {
      result: {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
    };
    assert.strictEqual(json.result.isError, true);
    assert.strictEqual(
      json.result.content[0].text.includes('パスコード'),
      true,
    );
  });

  test('`update_document` で新規画像を追加し、順次保存と Markdown 内パス置換が正常に行われること。', async () => {
    const newImageBase64 = Buffer.from('New Image Bytes', 'utf-8').toString(
      'base64',
    );

    const res = await app.request('/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_VALID_PAT_ALL}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 33,
        method: 'tools/call',
        params: {
          name: 'update_document',
          arguments: {
            id: TARGET_DOC_ID,
            content: '# 更新本文\n![新図](./images/diagram.png)',
            images: [
              {
                path: './images/diagram.png',
                base64Data: newImageBase64,
                mimeType: 'image/png',
              },
            ],
          },
        },
      }),
    });

    assert.strictEqual(res.status, 200);
    const json = (await res.json()) as {
      result: {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
    };
    assert.strictEqual(json.result.isError, undefined);

    // 新規画像が D1 attachments に登録されていること
    const newAtt = mockDb._attachmentStore.find(
      (a) => a.file_name === 'diagram.png',
    );
    assert.notStrictEqual(newAtt, undefined);
    assert.strictEqual(newAtt?.mime_type, 'image/png');

    // R2 に新規画像が保存されていること
    const imgObj = await mockR2.get(newAtt!.r2_key);
    assert.notStrictEqual(imgObj, null);

    // R2 本文内の画像パスが置換されていること
    const r2Text = await (await mockR2.get(
      'exp-7d/uploads/uuid-up/content.md',
    ))!.text();
    assert.strictEqual(r2Text.includes(`/api/assets/${newAtt!.r2_key}`), true);
  });
});
