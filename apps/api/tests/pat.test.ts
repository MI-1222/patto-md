import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  AUTH_SESSION_COOKIE_NAME,
  PAT_PATTERN,
  PATTO_PAT_PREFIX,
  createPatRequestSchema,
  createPatResponseSchema,
  generateCapabilityToken,
  hashToken,
  userApiTokenItemSchema,
  type AuthMeResponse,
  type AuthUser,
  type CreatePatResponse,
  type DeletePatResponse,
  type DocumentCommitResponse,
  type DocumentListResponse,
  type UploadSignResponse,
  type UserApiTokenListResponse,
  type UserApiTokenRecord,
} from '@patto-md/shared';
import { Hono } from 'hono';
import { createDocumentAuthMiddleware } from '../src/lib/auth.ts';
import {
  calculatePatExpiration,
  generatePat,
  hashPat,
  isPat,
  maskPat,
  verifyPat,
} from '../src/lib/pat.ts';
import { createSessionToken } from '../src/lib/session.ts';
import {
  createOptionalPatOrTurnstileMiddleware,
  requirePatScope,
} from '../src/middlewares/pat-auth.ts';
import { authRouter } from '../src/routes/auth.ts';
import { documentsRouter } from '../src/routes/documents.ts';
import { uploadRouter } from '../src/routes/upload.ts';
import { userTokensRouter } from '../src/routes/user-tokens.ts';
import type { AppEnv, AuthenticatedDocument } from '../src/types.ts';

describe('パーソナルアクセストークン生成処理 (`generatePat`)', () => {
  test('PATがプレフィックス付きで仕様通りの Base62 形式で生成されること。', () => {
    const token = generatePat();
    assert.strictEqual(token.startsWith(PATTO_PAT_PREFIX), true);
    assert.strictEqual(PAT_PATTERN.test(token), true);
    assert.strictEqual(token.length, PATTO_PAT_PREFIX.length + 43);
  });

  test('連続して生成されたトークンが一意かつ推測不能であること。', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const token = generatePat();
      assert.strictEqual(tokens.has(token), false);
      tokens.add(token);
    }
    assert.strictEqual(tokens.size, 50);
  });
});

describe('PATハッシュ計算処理 (`hashPat`)', () => {
  test('SHA-256 ハッシュが決定論的かつ小文字64文字の Hex 文字列として算出されること。', async () => {
    const token = 'pmd_pat_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef1';
    const hash1 = await hashPat(token);
    const hash2 = await hashPat(token);

    assert.strictEqual(hash1, hash2);
    assert.strictEqual(hash1.length, 64);
    assert.strictEqual(/^[0-9a-f]{64}$/.test(hash1), true);
  });

  test('異なるトークンからは異なるハッシュ値が算出されること。', async () => {
    const hashA = await hashPat(
      'pmd_pat_tokenA1234567890123456789012345678901234567',
    );
    const hashB = await hashPat(
      'pmd_pat_tokenB1234567890123456789012345678901234567',
    );

    assert.notStrictEqual(hashA, hashB);
  });
});

describe('PAT定数時間照合処理 (`verifyPat`)', () => {
  test('平文トークンと期待ハッシュ値が一致する場合に `true` を返すこと。', async () => {
    const token = generatePat();
    const hash = await hashPat(token);

    const isValid = await verifyPat(token, hash);
    assert.strictEqual(isValid, true);
  });

  test('異なるトークンまたは異なるハッシュ値で `false` を返すこと。', async () => {
    const tokenA = generatePat();
    const tokenB = generatePat();
    const hashA = await hashPat(tokenA);

    const isValid = await verifyPat(tokenB, hashA);
    assert.strictEqual(isValid, false);
  });

  test('空文字や `null`、`undefined` に対しても例外を投げずに `false` を返すこと。', async () => {
    const token = generatePat();
    assert.strictEqual(await verifyPat('', 'somehash'), false);
    assert.strictEqual(await verifyPat(token, null), false);
    assert.strictEqual(await verifyPat(token, undefined), false);
    assert.strictEqual(await verifyPat(token, ''), false);
  });
});

describe('PAT形式判定 (`isPat`)', () => {
  test('正規の PAT 文字列に対して `true` を返すこと。', () => {
    const token = generatePat();
    assert.strictEqual(isPat(token), true);
  });

  test('無効なプレフィックスや文字長・文字種に対して `false` を返すこと。', () => {
    assert.strictEqual(isPat('invalid_token'), false);
    assert.strictEqual(
      isPat('pt_edt_0123456789012345678901234567890123456789012'),
      false,
    );
    assert.strictEqual(isPat('pmd_pat_short'), false);
    // 42文字(1文字不足)。
    assert.strictEqual(
      isPat('pmd_pat_012345678901234567890123456789012345678901'),
      false,
    );
    // 44文字(1文字超過)。
    assert.strictEqual(
      isPat('pmd_pat_01234567890123456789012345678901234567890123'),
      false,
    );
    assert.strictEqual(
      isPat('pmd_pat_invalid!character!with!special!symbols!123456'),
      false,
    );
    assert.strictEqual(isPat(''), false);
  });
});

describe('PAT有効期限計算 (`calculatePatExpiration`)', () => {
  test('`never` 指定時に `null` を返すこと。', () => {
    assert.strictEqual(calculatePatExpiration('never'), null);
  });

  test('各プリセットで基準日時から正確な秒数後の ISO 8601 文字列が返されること。', () => {
    const baseDate = new Date('2026-11-01T00:00:00.000Z');

    const exp30d = calculatePatExpiration('30days', baseDate);
    assert.strictEqual(
      exp30d,
      new Date('2026-12-01T00:00:00.000Z').toISOString(),
    );

    const exp90d = calculatePatExpiration('90days', baseDate);
    assert.strictEqual(
      exp90d,
      new Date('2027-01-30T00:00:00.000Z').toISOString(),
    );

    const exp1y = calculatePatExpiration('1year', baseDate);
    assert.strictEqual(
      exp1y,
      new Date('2027-11-01T00:00:00.000Z').toISOString(),
    );
  });
});

describe('PATマスク文字列生成 (`maskPat`)', () => {
  test('トークンのプレフィックスと末尾4文字が残り、中間がマスクされること。', () => {
    const token = 'pmd_pat_123456789012345678901234567890123456789abcd';
    const masked = maskPat(token);
    assert.strictEqual(masked, 'pmd_pat_...abcd');
  });

  test('不正な形式や短い文字列でも安全にフォールバックすること。', () => {
    assert.strictEqual(maskPat(''), 'pmd_pat_...');
    assert.strictEqual(maskPat('invalid'), 'pmd_pat_...');
  });
});

describe('PAT Zod スキーマ検証', () => {
  test('正常な PAT 発行要求がパースされ、スコープの重複が排除されること。', () => {
    const parsed = createPatRequestSchema.parse({
      name: 'Cursor IDE',
      scopes: ['documents:read', 'documents:write', 'documents:read'],
      expiration: '90days',
    });

    assert.strictEqual(parsed.name, 'Cursor IDE');
    assert.deepStrictEqual(parsed.scopes, [
      'documents:read',
      'documents:write',
    ]);
    assert.strictEqual(parsed.expiration, '90days');
  });

  test('無効なリクエストが拒絶されること。', () => {
    // 空文字または空白のみの名前。
    assert.throws(() =>
      createPatRequestSchema.parse({
        name: '   ',
        scopes: ['documents:read'],
        expiration: '30days',
      }),
    );

    // スコープが空配列。
    assert.throws(() =>
      createPatRequestSchema.parse({
        name: 'CLI',
        scopes: [],
        expiration: '30days',
      }),
    );

    // 不正な有効期限プリセット。
    assert.throws(() =>
      createPatRequestSchema.parse({
        name: 'CLI',
        scopes: ['documents:read'],
        expiration: '10days',
      }),
    );
  });

  test('PATレスポンススキーマおよび一覧アイテムスキーマの検証。', () => {
    const token = generatePat();
    const nowIso = new Date().toISOString();

    const response = createPatResponseSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Test PAT',
      token,
      scopes: ['documents:read'],
      expiresAt: null,
      createdAt: nowIso,
    });
    assert.strictEqual(response.token, token);

    const listItem = userApiTokenItemSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Test PAT',
      tokenMasked: maskPat(token),
      scopes: ['documents:read'],
      expiresAt: null,
      lastUsedAt: null,
      createdAt: nowIso,
    });
    assert.strictEqual(listItem.tokenMasked.startsWith(PATTO_PAT_PREFIX), true);
  });
});

/** テスト用 JWT シークレット。 */
const TEST_JWT_SECRET = 'test-jwt-secret-key-32bytes-long-for-testing';

/** テスト用ダミーユーザー。 */
const testUserA: AuthUser = {
  provider: 'github',
  providerUserId: 'user-github-12345',
  username: 'patto-tester',
  avatarUrl: null,
};

const testUserB: AuthUser = {
  provider: 'discord',
  providerUserId: 'user-discord-99999',
  username: 'other-user',
  avatarUrl: null,
};

/**
 * テスト用インメモリ D1 データベースを生成する。
 *
 * @param initialTokens - 初期投入するトークンレコード配列。
 * @param initialDocs - 初期投入するドキュメントレコード配列。
 */
function createMockD1Database(
  initialTokens: Partial<UserApiTokenRecord>[] = [],
  initialDocs: AuthenticatedDocument[] = [],
) {
  const tokenStore = initialTokens.map((t) => ({
    id: t.id ?? 'default-id',
    user_id: t.user_id ?? 'default-user',
    name: t.name ?? 'default-name',
    token_hash: t.token_hash ?? 'defaulthash',
    token_last4:
      t.token_last4 ?? (t.token_hash ? t.token_hash.slice(-4) : '0000'),
    scopes: t.scopes ?? '["documents:read"]',
    expires_at: t.expires_at ?? null,
    last_used_at: t.last_used_at ?? null,
    created_at: t.created_at ?? new Date().toISOString(),
  })) as UserApiTokenRecord[];
  const docStore = [...initialDocs];
  const updatedTokens: Array<{ id: string; lastUsedAt: string }> = [];

  const mockDb = {
    _tokenStore: tokenStore,
    _docStore: docStore,
    _updatedTokens: updatedTokens,

    prepare(query: string) {
      let boundParams: unknown[] = [];

      return {
        bind(...params: unknown[]) {
          boundParams = params;
          return this;
        },

        async first<T = unknown>(): Promise<T | null> {
          const sql = query.replace(/\s+/g, ' ').trim();

          // PAT ハッシュ照合クエリ。
          if (sql.includes('FROM user_api_tokens WHERE token_hash = ?')) {
            const hash = boundParams[0] as string;
            const found = tokenStore.find((t) => t.token_hash === hash);
            return (found as unknown as T) ?? null;
          }

          // ドキュメント取得クエリ。
          if (sql.includes('FROM documents WHERE id = ?')) {
            const id = boundParams[0] as string;
            const found = docStore.find((d) => d.id === id);
            return (found as unknown as T) ?? null;
          }

          // ドキュメント総件数カウント。
          if (sql.includes('SELECT COUNT(*) AS total FROM documents')) {
            return { total: docStore.length } as unknown as T;
          }

          return null;
        },

        async all<T = unknown>(): Promise<{ results: T[] }> {
          const sql = query.replace(/\s+/g, ' ').trim();

          // ユーザー別 PAT 一覧取得クエリ。
          if (sql.includes('FROM user_api_tokens WHERE user_id = ?')) {
            const userId = boundParams[0] as string;
            const list = tokenStore
              .filter((t) => t.user_id === userId)
              .sort(
                (a, b) =>
                  new Date(b.created_at).getTime() -
                  new Date(a.created_at).getTime(),
              );
            return { results: list as unknown as T[] };
          }

          // ドキュメント一覧取得クエリ。
          if (sql.includes('FROM documents')) {
            const list = docStore.map((doc) => ({
              id: doc.id,
              title: doc.title,
              description: doc.description,
              expires_at: doc.expires_at,
              visibility: doc.visibility,
              created_at: doc.created_at,
              attachment_count: 0,
            }));
            return { results: list as unknown as T[] };
          }

          // 添付ファイル取得クエリ。
          if (sql.includes('FROM attachments WHERE document_id = ?')) {
            return { results: [] };
          }

          return { results: [] };
        },

        async run(): Promise<{ meta: { changes: number } }> {
          const sql = query.replace(/\s+/g, ' ').trim();

          // PAT レコードの挿入処理。
          if (sql.includes('INSERT INTO user_api_tokens')) {
            const [
              id,
              userId,
              name,
              tokenHash,
              tokenLast4,
              scopesJson,
              expiresAt,
              createdAt,
            ] = boundParams as [
              string,
              string,
              string,
              string,
              string,
              string,
              string | null,
              string,
            ];
            tokenStore.push({
              id,
              user_id: userId,
              name,
              token_hash: tokenHash,
              token_last4: tokenLast4,
              scopes: scopesJson,
              expires_at: expiresAt,
              last_used_at: null,
              created_at: createdAt,
            });
            return { meta: { changes: 1 } };
          }

          // PAT レコードの削除処理。
          if (sql.includes('DELETE FROM user_api_tokens WHERE id = ?')) {
            const [id, userId] = boundParams as [string, string];
            const index = tokenStore.findIndex(
              (t) => t.id === id && t.user_id === userId,
            );
            if (index !== -1) {
              tokenStore.splice(index, 1);
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }

          // PAT の `last_used_at` 更新処理。
          if (sql.includes('UPDATE user_api_tokens SET last_used_at = ?')) {
            const [lastUsedAt, id] = boundParams as [string, string];
            const found = tokenStore.find((t) => t.id === id);
            if (found) {
              found.last_used_at = lastUsedAt;
              updatedTokens.push({ id, lastUsedAt });
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }

          // ドキュメントの論理削除処理。
          if (sql.includes('UPDATE documents SET status = ?')) {
            return { meta: { changes: 1 } };
          }

          return { meta: { changes: 0 } };
        },
      };
    },

    async batch(statements: Array<{ run?: () => Promise<unknown> }>) {
      for (const stmt of statements) {
        if (typeof stmt.run === 'function') {
          await stmt.run();
        }
      }
      return [];
    },
  };

  return mockDb as unknown as D1Database & {
    _tokenStore: UserApiTokenRecord[];
    _docStore: AuthenticatedDocument[];
    _updatedTokens: Array<{ id: string; lastUsedAt: string }>;
  };
}

/** テスト用 R2 バケットモック。 */
function createMockR2Bucket() {
  return {
    async head() {
      return { key: 'test-key' };
    },
    async get() {
      return {
        text: async () => '# Test Document Content',
        body: null,
      };
    },
    async put() {
      return {};
    },
    async delete() {
      return {};
    },
  };
}

describe('PAT管理APIサブルーター (`/api/user/tokens`)', () => {
  let sessionTokenUserA: string;
  let sessionTokenUserB: string;

  test('テスト用セッショントークンの事前発行。', async () => {
    sessionTokenUserA = (await createSessionToken(testUserA, TEST_JWT_SECRET))
      .token;
    sessionTokenUserB = (await createSessionToken(testUserB, TEST_JWT_SECRET))
      .token;
    assert.strictEqual(typeof sessionTokenUserA, 'string');
    assert.strictEqual(typeof sessionTokenUserB, 'string');
  });

  test('未認証(セッションCookieなし)でアクセスした場合に 401 で弾かれること。', async () => {
    const mockDb = createMockD1Database();
    const app = new Hono<AppEnv>();

    app.use('*', async (c, next) => {
      c.env = {
        ...c.env,
        DB: mockDb,
        JWT_SECRET: TEST_JWT_SECRET,
      };
      await next();
    });
    app.route('/api/user/tokens', userTokensRouter);

    const postRes = await app.request('/api/user/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Cursor',
        scopes: ['documents:read'],
        expiration: '30days',
      }),
    });
    assert.strictEqual(postRes.status, 401);

    const getRes = await app.request('/api/user/tokens');
    assert.strictEqual(getRes.status, 401);

    const deleteRes = await app.request('/api/user/tokens/dummy-id', {
      method: 'DELETE',
    });
    assert.strictEqual(deleteRes.status, 401);
  });

  test('POST /api/user/tokens で PAT を新規発行し、平文トークンがワンタイム返却され DB にハッシュ保存されること。', async () => {
    const mockDb = createMockD1Database();
    const app = new Hono<AppEnv>();

    app.use('*', async (c, next) => {
      c.env = {
        ...c.env,
        DB: mockDb,
        JWT_SECRET: TEST_JWT_SECRET,
      };
      await next();
    });
    app.route('/api/user/tokens', userTokensRouter);

    const res = await app.request('/api/user/tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_SESSION_COOKIE_NAME}=${sessionTokenUserA}`,
      },
      body: JSON.stringify({
        name: 'MacBook Pro CLI',
        scopes: ['documents:read', 'documents:write'],
        expiration: '90days',
      }),
    });

    assert.strictEqual(res.status, 201);
    const body = (await res.json()) as CreatePatResponse;

    assert.strictEqual(body.name, 'MacBook Pro CLI');
    assert.strictEqual(isPat(body.token), true);
    assert.deepStrictEqual(body.scopes, ['documents:read', 'documents:write']);
    assert.notStrictEqual(body.expiresAt, null);

    // D1 に正しくハッシュで保存されていることを確認。
    assert.strictEqual(mockDb._tokenStore.length, 1);
    const stored = mockDb._tokenStore[0]!;
    assert.strictEqual(stored.user_id, 'github:user-github-12345');
    assert.strictEqual(stored.name, 'MacBook Pro CLI');
    assert.notStrictEqual(stored.token_hash, body.token);
    assert.strictEqual(await verifyPat(body.token, stored.token_hash), true);
    assert.strictEqual(stored.token_last4, body.token.slice(-4));
  });

  test('POST /api/user/tokens でリクエストが不正な場合に 400 Bad Request を返すこと。', async () => {
    const mockDb = createMockD1Database();
    const app = new Hono<AppEnv>();

    app.use('*', async (c, next) => {
      c.env = {
        ...c.env,
        DB: mockDb,
        JWT_SECRET: TEST_JWT_SECRET,
      };
      await next();
    });
    app.route('/api/user/tokens', userTokensRouter);

    // 名前が空の場合。
    const resEmptyName = await app.request('/api/user/tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_SESSION_COOKIE_NAME}=${sessionTokenUserA}`,
      },
      body: JSON.stringify({
        name: '',
        scopes: ['documents:read'],
        expiration: '30days',
      }),
    });
    assert.strictEqual(resEmptyName.status, 400);

    // スコープが空配列の場合。
    const resEmptyScopes = await app.request('/api/user/tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_SESSION_COOKIE_NAME}=${sessionTokenUserA}`,
      },
      body: JSON.stringify({
        name: 'CLI',
        scopes: [],
        expiration: '30days',
      }),
    });
    assert.strictEqual(resEmptyScopes.status, 400);
  });

  test('GET /api/user/tokens で自分のトークン一覧のみがマスク形式で取得できること。', async () => {
    const plainTokenA = generatePat();
    const hashA = await hashPat(plainTokenA);

    const plainTokenB = generatePat();
    const hashB = await hashPat(plainTokenB);

    const mockDb = createMockD1Database([
      {
        id: 'token-a-1',
        user_id: 'github:user-github-12345',
        name: 'User A Token',
        token_hash: hashA,
        token_last4: plainTokenA.slice(-4),
        scopes: JSON.stringify(['documents:read', 'documents:write']),
        expires_at: null,
        last_used_at: null,
        created_at: new Date('2026-11-01T10:00:00Z').toISOString(),
      },
      {
        id: 'token-b-1',
        user_id: 'discord:user-discord-99999',
        name: 'User B Token',
        token_hash: hashB,
        token_last4: plainTokenB.slice(-4),
        scopes: JSON.stringify(['documents:read']),
        expires_at: null,
        last_used_at: null,
        created_at: new Date('2026-11-01T11:00:00Z').toISOString(),
      },
    ]);

    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.env = {
        ...c.env,
        DB: mockDb,
        JWT_SECRET: TEST_JWT_SECRET,
      };
      await next();
    });
    app.route('/api/user/tokens', userTokensRouter);

    const res = await app.request('/api/user/tokens', {
      headers: {
        Cookie: `${AUTH_SESSION_COOKIE_NAME}=${sessionTokenUserA}`,
      },
    });

    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as UserApiTokenListResponse;

    assert.strictEqual(body.tokens.length, 1);
    const item = body.tokens[0]!;
    assert.strictEqual(item.id, 'token-a-1');
    assert.strictEqual(item.name, 'User A Token');
    // 平文・ハッシュ値が一切漏洩せずマスクされていること。
    assert.strictEqual('token' in item, false);
    assert.strictEqual('token_hash' in item, false);
    // マスク文字列の末尾4文字が平文トークンの末尾4文字と一致すること。
    assert.strictEqual(
      item.tokenMasked,
      `${PATTO_PAT_PREFIX}...${plainTokenA.slice(-4)}`,
    );
    assert.deepStrictEqual(item.scopes, ['documents:read', 'documents:write']);
  });

  test('DELETE /api/user/tokens/:id でトークンが物理削除され、他人のトークン削除は 404 となること。', async () => {
    const mockDb = createMockD1Database([
      {
        id: 'token-a-1',
        user_id: 'github:user-github-12345',
        name: 'User A Token',
        token_hash: 'dummyhash1',
        scopes: JSON.stringify(['documents:read']),
        expires_at: null,
        last_used_at: null,
        created_at: new Date().toISOString(),
      },
    ]);

    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.env = {
        ...c.env,
        DB: mockDb,
        JWT_SECRET: TEST_JWT_SECRET,
      };
      await next();
    });
    app.route('/api/user/tokens', userTokensRouter);

    // ユーザーBがユーザーAのトークンを削除しようとすると 404 を返却。
    const resOther = await app.request('/api/user/tokens/token-a-1', {
      method: 'DELETE',
      headers: {
        Cookie: `${AUTH_SESSION_COOKIE_NAME}=${sessionTokenUserB}`,
      },
    });
    assert.strictEqual(resOther.status, 404);
    assert.strictEqual(mockDb._tokenStore.length, 1);

    // ユーザーA自身が削除すると 200 で削除完了。
    const resOwner = await app.request('/api/user/tokens/token-a-1', {
      method: 'DELETE',
      headers: {
        Cookie: `${AUTH_SESSION_COOKIE_NAME}=${sessionTokenUserA}`,
      },
    });
    assert.strictEqual(resOwner.status, 200);
    const body = (await resOwner.json()) as DeletePatResponse;
    assert.strictEqual(body.success, true);
    assert.strictEqual(mockDb._tokenStore.length, 0);
  });
});

describe('PAT認可ミドルウェア (`createPatAuthMiddleware` / `requirePatScope`)', () => {
  test('有効な PAT を指定した場合に認可され、コンテキスト変数へ注入されること。', async () => {
    const plainToken = generatePat();
    const hash = await hashPat(plainToken);

    const mockDb = createMockD1Database([
      {
        id: 'pat-1',
        user_id: 'github:user-github-12345',
        name: 'Cursor IDE',
        token_hash: hash,
        scopes: JSON.stringify(['documents:read', 'documents:write']),
        expires_at: null,
        last_used_at: null,
        created_at: new Date().toISOString(),
      },
    ]);

    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.env = { ...c.env, DB: mockDb };
      await next();
    });

    app.get('/test-protected', requirePatScope('documents:read'), (c) => {
      const patUser = c.get('patUser');
      const user = c.get('user');
      return c.json({
        ok: true,
        patUser,
        user,
      });
    });

    const res = await app.request('/test-protected', {
      headers: {
        Authorization: `Bearer ${plainToken}`,
      },
    });

    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      patUser: { userId: string };
      user: { provider: string; providerUserId: string };
    };
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.patUser.userId, 'github:user-github-12345');
    assert.strictEqual(body.user.provider, 'github');
    assert.strictEqual(body.user.providerUserId, 'user-github-12345');
  });

  test('スコープ不足の PAT でアクセスした場合に 403 Forbidden が返却されること。', async () => {
    const plainToken = generatePat();
    const hash = await hashPat(plainToken);

    const mockDb = createMockD1Database([
      {
        id: 'pat-read-only',
        user_id: 'github:user-github-12345',
        name: 'Read Only Token',
        token_hash: hash,
        scopes: JSON.stringify(['documents:read']),
        expires_at: null,
        last_used_at: null,
        created_at: new Date().toISOString(),
      },
    ]);

    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.env = { ...c.env, DB: mockDb };
      await next();
    });

    app.post('/test-write', requirePatScope('documents:write'), (c) => {
      return c.json({ ok: true });
    });

    const res = await app.request('/test-write', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${plainToken}`,
      },
    });

    assert.strictEqual(res.status, 403);
    const body = (await res.json()) as { error: { message: string } };
    assert.strictEqual(
      body.error.message,
      '操作に必要な権限(スコープ: documents:write)がありません。',
    );
  });

  test('有効期限切れの PAT でアクセスした場合に 401 が返却されること。', async () => {
    const plainToken = generatePat();
    const hash = await hashPat(plainToken);

    const expiredIso = new Date('2020-01-01T00:00:00Z').toISOString();
    const mockDb = createMockD1Database([
      {
        id: 'pat-expired',
        user_id: 'github:user-github-12345',
        name: 'Expired Token',
        token_hash: hash,
        scopes: JSON.stringify(['documents:read']),
        expires_at: expiredIso,
        last_used_at: null,
        created_at: new Date('2019-12-01T00:00:00Z').toISOString(),
      },
    ]);

    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.env = { ...c.env, DB: mockDb };
      await next();
    });

    app.get('/test-route', requirePatScope('documents:read'), (c) => {
      return c.json({ ok: true });
    });

    const res = await app.request('/test-route', {
      headers: {
        Authorization: `Bearer ${plainToken}`,
      },
    });

    assert.strictEqual(res.status, 401);
    const body = (await res.json()) as { error: { message: string } };
    assert.strictEqual(
      body.error.message,
      '無効または有効期限切れのPATトークンです。',
    );
  });

  test('`createOptionalPatOrTurnstileMiddleware` でトークン未指定時は Turnstile が実行されること。', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.env = {
        ...c.env,
        TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
      };
      await next();
    });

    app.post(
      '/test-upload',
      createOptionalPatOrTurnstileMiddleware('documents:write'),
      (c) => c.json({ ok: true }),
    );

    // Turnstile ヘッダーなし時は 400 を返却。
    const resNoHeader = await app.request('/test-upload', {
      method: 'POST',
    });
    assert.strictEqual(resNoHeader.status, 400);

    // テスト用 Always Pass トークン指定時は 200 で通過。
    const resValidTurnstile = await app.request('/test-upload', {
      method: 'POST',
      headers: {
        'cf-turnstile-response': 'dummy-turnstile-token',
      },
    });
    assert.strictEqual(resValidTurnstile.status, 200);
  });

  test('last_used_at が未設定または5分以上前の場合に更新され、5分以内のアクセスでは更新がスキップされること。', async () => {
    const plainToken = generatePat();
    const hash = await hashPat(plainToken);

    // 10分前の利用履歴。
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const mockDb = createMockD1Database([
      {
        id: 'pat-throttling',
        user_id: 'github:user-github-12345',
        name: 'Throttling Test',
        token_hash: hash,
        scopes: JSON.stringify(['documents:read']),
        expires_at: null,
        last_used_at: tenMinutesAgo,
        created_at: new Date().toISOString(),
      },
    ]);

    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.env = { ...c.env, DB: mockDb };
      await next();
    });
    app.get('/test-route', requirePatScope('documents:read'), (c) => {
      return c.json({ ok: true });
    });

    // 1回目のアクセス: 10分前なので更新が発火する。
    const res1 = await app.request('/test-route', {
      headers: { Authorization: `Bearer ${plainToken}` },
    });
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(mockDb._updatedTokens.length, 1);

    // 2回目の連続アクセス: `last_used_at` は直前(5分以内)のためスキップされる。
    const res2 = await app.request('/test-route', {
      headers: { Authorization: `Bearer ${plainToken}` },
    });
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(mockDb._updatedTokens.length, 1);
  });
});

describe('ドキュメント認可・API統合 (PAT とのハイブリッド連携)', () => {
  const dummySlug = 'abcdef123456';

  test('PAT所有者が自ドキュメントの更新(modify)および削除(edit)を認可されること。', async () => {
    const plainToken = generatePat();
    const hash = await hashPat(plainToken);

    const doc: AuthenticatedDocument = {
      id: dummySlug,
      title: '所有ドキュメント',
      description: null,
      content_r2_key: 'contents/test.md',
      status: 'published',
      expires_at: null,
      edit_token_hash: 'edithash123',
      modify_token_hash: 'modifyhash123',
      owner_user_id: 'user-github-12345',
      owner_provider: 'github',
      visibility: 'public',
      passcode_hash: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const mockDb = createMockD1Database(
      [
        {
          id: 'pat-owner',
          user_id: 'github:user-github-12345',
          name: 'Owner PAT',
          token_hash: hash,
          scopes: JSON.stringify([
            'documents:read',
            'documents:write',
            'documents:delete',
          ]),
          expires_at: null,
          last_used_at: null,
          created_at: new Date().toISOString(),
        },
      ],
      [doc],
    );

    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.env = { ...c.env, DB: mockDb };
      await next();
    });

    app.put('/api/documents/:id', createDocumentAuthMiddleware('modify'), (c) =>
      c.json({ action: 'updated' }),
    );

    app.delete(
      '/api/documents/:id',
      createDocumentAuthMiddleware('edit'),
      (c) => c.json({ action: 'deleted' }),
    );

    // `PUT` リクエストに対する `modify` ロール認可。
    const putRes = await app.request(`/api/documents/${dummySlug}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${plainToken}` },
    });
    assert.strictEqual(putRes.status, 200);

    // `DELETE` リクエストに対する `edit` ロール認可。
    const delRes = await app.request(`/api/documents/${dummySlug}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${plainToken}` },
    });
    assert.strictEqual(delRes.status, 200);
  });

  test('PAT所有者が他人のドキュメントを更新しようとした場合に 403 で遮断されること。', async () => {
    const plainToken = generatePat();
    const hash = await hashPat(plainToken);

    const doc: AuthenticatedDocument = {
      id: dummySlug,
      title: '他人のドキュメント',
      description: null,
      content_r2_key: 'contents/test.md',
      status: 'published',
      expires_at: null,
      edit_token_hash: 'edithash123',
      modify_token_hash: 'modifyhash123',
      owner_user_id: 'another-user-999',
      owner_provider: 'github',
      visibility: 'public',
      passcode_hash: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const mockDb = createMockD1Database(
      [
        {
          id: 'pat-other',
          user_id: 'github:user-github-12345',
          name: 'PAT',
          token_hash: hash,
          scopes: JSON.stringify(['documents:write']),
          expires_at: null,
          last_used_at: null,
          created_at: new Date().toISOString(),
        },
      ],
      [doc],
    );

    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.env = { ...c.env, DB: mockDb };
      await next();
    });

    app.put('/api/documents/:id', createDocumentAuthMiddleware('modify'), (c) =>
      c.json({ action: 'updated' }),
    );

    const putRes = await app.request(`/api/documents/${dummySlug}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${plainToken}` },
    });
    assert.strictEqual(putRes.status, 403);
  });

  test('ケイパビリティトークン(pt_edt_...)も競合することなく正常に認可されること。', async () => {
    const editToken = generateCapabilityToken('edit');
    const editTokenHash = await hashToken(editToken);

    const doc: AuthenticatedDocument = {
      id: dummySlug,
      title: '匿名ドキュメント',
      description: null,
      content_r2_key: 'contents/test.md',
      status: 'published',
      expires_at: null,
      edit_token_hash: editTokenHash,
      modify_token_hash: null,
      owner_user_id: null,
      owner_provider: null,
      visibility: 'public',
      passcode_hash: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const mockDb = createMockD1Database([], [doc]);

    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.env = { ...c.env, DB: mockDb };
      await next();
    });

    app.delete(
      '/api/documents/:id',
      createDocumentAuthMiddleware('edit'),
      (c) => c.json({ action: 'deleted' }),
    );

    const delRes = await app.request(`/api/documents/${dummySlug}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${editToken}` },
    });
    assert.strictEqual(delRes.status, 200);
  });

  test('POST /api/upload/sign で PAT(documents:write) を付与した場合、Turnstile 検証をバイパスして署名が発行されること。', async () => {
    const plainToken = generatePat();
    const hash = await hashPat(plainToken);

    const mockDb = createMockD1Database([
      {
        id: 'pat-uploader',
        user_id: 'github:user-github-12345',
        name: 'Uploader PAT',
        token_hash: hash,
        scopes: JSON.stringify(['documents:write']),
        expires_at: null,
        last_used_at: null,
        created_at: new Date().toISOString(),
      },
    ]);

    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.env = {
        ...c.env,
        DB: mockDb,
        CLOUDFLARE_ACCOUNT_ID: 'dummy-account',
        R2_ACCESS_KEY_ID: 'dummy-key',
        R2_SECRET_ACCESS_KEY: 'dummy-secret',
        R2_BUCKET_NAME: 'dummy-bucket',
      };
      await next();
    });
    app.route('/api/upload', uploadRouter);

    const res = await app.request('/api/upload/sign', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${plainToken}`,
      },
      body: JSON.stringify({
        files: [{ name: 'test.md', size: 1024, type: 'text/markdown' }],
        expiration: '7days',
      }),
    });

    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as UploadSignResponse;
    assert.strictEqual(body.files.length, 1);
    assert.strictEqual(body.files[0]?.fileName, 'test.md');
  });

  test('POST /api/documents で PAT(documents:write) を付与した場合、所有者情報が自動設定されること。', async () => {
    const plainToken = generatePat();
    const hash = await hashPat(plainToken);

    const mockDb = createMockD1Database([
      {
        id: 'pat-writer',
        user_id: 'github:user-github-12345',
        name: 'Writer PAT',
        token_hash: hash,
        scopes: JSON.stringify(['documents:write']),
        expires_at: null,
        last_used_at: null,
        created_at: new Date().toISOString(),
      },
    ]);

    const mockBucket = createMockR2Bucket();

    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.env = {
        ...c.env,
        DB: mockDb,
        BUCKET: mockBucket as unknown as R2Bucket,
        CLOUDFLARE_ACCOUNT_ID: 'dummy-account',
        R2_ACCESS_KEY_ID: 'dummy-key',
        R2_SECRET_ACCESS_KEY: 'dummy-secret',
        R2_BUCKET_NAME: 'dummy-bucket',
      };
      await next();
    });
    app.route('/api/documents', documentsRouter);

    const res = await app.request('/api/documents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${plainToken}`,
      },
      body: JSON.stringify({
        title: 'PAT作成ドキュメント',
        contentR2Key: 'exp-7d/uploads/uuid/content.md',
        attachments: [],
        expiration: '7days',
      }),
    });

    assert.strictEqual(res.status, 201);
    const body = (await res.json()) as DocumentCommitResponse;
    assert.strictEqual(body.title, 'PAT作成ドキュメント');
  });

  test('GET /api/documents?mine=true で PAT(documents:read) を付与した場合、ドキュメント一覧が取得できること。', async () => {
    const plainToken = generatePat();
    const hash = await hashPat(plainToken);

    const mockDb = createMockD1Database([
      {
        id: 'pat-reader',
        user_id: 'github:user-github-12345',
        name: 'Reader PAT',
        token_hash: hash,
        scopes: JSON.stringify(['documents:read']),
        expires_at: null,
        last_used_at: null,
        created_at: new Date().toISOString(),
      },
    ]);

    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.env = {
        ...c.env,
        DB: mockDb,
      };
      await next();
    });
    app.route('/api/documents', documentsRouter);

    const res = await app.request('/api/documents?mine=true', {
      headers: {
        Authorization: `Bearer ${plainToken}`,
      },
    });

    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as DocumentListResponse;
    assert.strictEqual(Array.isArray(body.items), true);
  });

  test('GET /api/documents/:id で PAT を付与して閲覧した場合、Cache-Control に private, no-cache, no-store および Vary に Authorization が設定されること。', async () => {
    const plainToken = generatePat();
    const hash = await hashPat(plainToken);

    const doc: AuthenticatedDocument = {
      id: dummySlug,
      title: '公開ドキュメント',
      description: null,
      content_r2_key: 'exp-7d/content.md',
      edit_token_hash: 'edithash',
      modify_token_hash: 'modifyhash',
      visibility: 'public',
      status: 'published',
      passcode_hash: null,
      owner_user_id: 'user-github-12345',
      owner_provider: 'github',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const mockDb = createMockD1Database(
      [
        {
          id: 'pat-reader',
          user_id: 'github:user-github-12345',
          name: 'Reader PAT',
          token_hash: hash,
          scopes: JSON.stringify(['documents:read']),
          expires_at: null,
          last_used_at: null,
          created_at: new Date().toISOString(),
        },
      ],
      [doc],
    );

    const mockBucket = createMockR2Bucket();

    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.env = {
        ...c.env,
        DB: mockDb,
        BUCKET: mockBucket as unknown as R2Bucket,
      };
      await next();
    });
    app.route('/api/documents', documentsRouter);

    const res = await app.request(`/api/documents/${dummySlug}`, {
      headers: {
        Authorization: `Bearer ${plainToken}`,
      },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(
      res.headers.get('Cache-Control'),
      'private, no-cache, no-store',
    );
    assert.strictEqual(
      res.headers.get('Vary'),
      'Accept-Encoding, Authorization',
    );
  });

  test('GET /api/auth/me で PAT を付与した場合、PAT所有者のユーザー情報が返却されること。', async () => {
    const plainToken = generatePat();
    const hash = await hashPat(plainToken);

    const mockDb = createMockD1Database([
      {
        id: 'pat-auth-me',
        user_id: 'github:user-github-12345',
        name: 'GitHub PAT',
        token_hash: hash,
        scopes: JSON.stringify(['documents:read']),
        expires_at: null,
        last_used_at: null,
        created_at: new Date().toISOString(),
      },
    ]);

    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.env = {
        ...c.env,
        DB: mockDb,
        JWT_SECRET: TEST_JWT_SECRET,
      };
      await next();
    });
    app.route('/api/auth', authRouter);

    const res = await app.request('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${plainToken}`,
      },
    });

    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as AuthMeResponse;
    assert.notStrictEqual(body.user, null);
    assert.strictEqual(body.user?.provider, 'github');
    assert.strictEqual(body.user?.providerUserId, 'user-github-12345');
    assert.strictEqual(body.user?.username, 'GitHub PAT');
  });
});
