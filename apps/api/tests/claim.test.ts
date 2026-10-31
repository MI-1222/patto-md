import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { Hono } from 'hono';
import {
  AUTH_SESSION_COOKIE_NAME,
  generateCapabilityToken,
  hashToken,
  type AuthUser,
  type DocumentClaimResponse,
  type DocumentListResponse,
} from '@patto-md/shared';
import { createSessionToken } from '../src/lib/session.ts';
import { documentsRouter } from '../src/routes/documents.ts';
import type { AppEnv, AuthenticatedDocument } from '../src/types.ts';

describe('ドキュメント所有権移譲(Claim)およびマイリストAPI', () => {
  const dummySlug = 'AbCdEf123456';
  const dummySecret = 'test-jwt-secret-key-32-chars-long!!';
  let ipCounter = 1;

  const nextIp = () => `198.51.100.${ipCounter++}`;

  const mockUser: AuthUser = {
    provider: 'github',
    providerUserId: 'gh-user-12345',
    username: 'test-user',
    avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
  };

  const otherUser: AuthUser = {
    provider: 'discord',
    providerUserId: 'dc-user-99999',
    username: 'other-user',
    avatarUrl: null,
  };

  /** 有効なセッションCookie文字列を生成する。 */
  async function getSessionCookie(user: AuthUser = mockUser): Promise<string> {
    const { token } = await createSessionToken(user, dummySecret);
    return `${AUTH_SESSION_COOKIE_NAME}=${token}`;
  }

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
      title: '初期ドキュメントタイトル',
      description: '初期要約',
      content_r2_key: 'temp/uploads/valid-uuid/content.md',
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
    docs: AuthenticatedDocument[] = [],
    envOverrides?: Partial<AppEnv['Bindings']>,
  ) {
    const documentsList = docs.map((d) => ({ ...d }));

    const mockDb = {
      prepare: (query: string) => ({
        bind: (...args: unknown[]) => ({
          first: async <T>() => {
            if (query.includes('SELECT COUNT(*) AS total FROM documents')) {
              if (query.includes('d.owner_user_id = ?')) {
                const ownerUserId = args[0] as string;
                const ownerProvider = args[1] as string;
                const matched = documentsList.filter(
                  (d) =>
                    d.owner_user_id === ownerUserId &&
                    d.owner_provider === ownerProvider &&
                    d.status !== 'deleted',
                );
                return { total: matched.length } as T;
              }
              const matched = documentsList.filter(
                (d) => d.status === 'published',
              );
              return { total: matched.length } as T;
            }

            if (
              query.includes('FROM documents') &&
              query.includes('WHERE id = ?')
            ) {
              const targetId = args[0] as string;
              const found = documentsList.find((d) => d.id === targetId);
              return (found ? { ...found } : null) as T;
            }

            return null as T;
          },
          all: async <T>() => {
            if (query.includes('FROM documents d')) {
              let filtered = [...documentsList];
              if (query.includes('d.owner_user_id = ?')) {
                const ownerUserId = args[0] as string;
                const ownerProvider = args[1] as string;
                filtered = filtered.filter(
                  (d) =>
                    d.owner_user_id === ownerUserId &&
                    d.owner_provider === ownerProvider &&
                    d.status !== 'deleted',
                );
              } else {
                filtered = filtered.filter((d) => d.status === 'published');
              }

              const rows = filtered.map((d) => ({
                id: d.id,
                title: d.title,
                description: d.description,
                expires_at: d.expires_at,
                visibility: d.visibility,
                created_at: d.created_at,
                attachment_count: 0,
              }));

              return { results: rows } as { results: T[] };
            }
            return { results: [] } as { results: T[] };
          },
          run: async () => {
            if (
              query.includes('UPDATE documents') &&
              query.includes("status = 'deleted'")
            ) {
              const targetId = args[1] as string;
              const target = documentsList.find((d) => d.id === targetId);
              if (target) {
                target.status = 'deleted';
              }
              return { meta: { changes: 1 } };
            }

            if (
              query.includes('UPDATE documents') &&
              query.includes('SET owner_user_id = ?')
            ) {
              const [newOwnerId, newOwnerProvider, newUpdatedAt, targetId] =
                args;
              const target = documentsList.find((d) => d.id === targetId);
              if (
                !target ||
                target.status === 'deleted' ||
                target.status === 'suspended'
              ) {
                return { meta: { changes: 0 } };
              }
              if (
                target.owner_user_id !== null &&
                (target.owner_user_id !== newOwnerId ||
                  target.owner_provider !== newOwnerProvider)
              ) {
                return { meta: { changes: 0 } };
              }
              target.owner_user_id = newOwnerId as string;
              target.owner_provider = newOwnerProvider as 'github' | 'discord';
              target.updated_at = newUpdatedAt as string;
              return { meta: { changes: 1 } };
            }

            return { meta: { changes: 1 } };
          },
        }),
      }),
      batch: async () => [],
    };

    const mockBucket = {
      head: async () => ({ key: 'valid' }),
      get: async () => ({
        text: async () => '# 本文',
      }),
    };

    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.env = {
        DB: mockDb as unknown as D1Database,
        BUCKET: mockBucket as unknown as R2Bucket,
        JWT_SECRET: dummySecret,
        ...envOverrides,
      } as AppEnv['Bindings'];
      return next();
    });

    app.route('/api/documents', documentsRouter);
    return { app, documentsList };
  }

  describe('POST /api/documents/:id/claim (所有権移譲)', () => {
    test('未ログイン状態(セッションCookieなし)の場合は 401 を返却すること。', async () => {
      const { doc, editToken } = await createFixtureDoc();
      const { app } = buildTestApp([doc]);

      const res = await app.request(`/api/documents/${dummySlug}/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': nextIp(),
        },
        body: JSON.stringify({ editToken }),
      });

      assert.equal(res.status, 401);
      const json = (await res.json()) as { error: { message: string } };
      assert.match(
        json.error.message,
        /ドキュメントの所有権を移譲するにはログインが必要です/,
      );
    });

    test('無効な Slug 形式の場合は 400 を返却すること。', async () => {
      const cookie = await getSessionCookie();
      const { app } = buildTestApp([]);

      const res = await app.request('/api/documents/invalid-slug/claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': nextIp(),
          Cookie: cookie,
        },
        body: JSON.stringify({ editToken: generateCapabilityToken('edit') }),
      });

      assert.equal(res.status, 400);
      const json = (await res.json()) as { error: { message: string } };
      assert.match(json.error.message, /無効なドキュメント識別子です/);
    });

    test('editToken が未指定または形式不正の場合は 400 を返却すること。', async () => {
      const cookie = await getSessionCookie();
      const { doc } = await createFixtureDoc();
      const { app } = buildTestApp([doc]);

      const res = await app.request(`/api/documents/${dummySlug}/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': nextIp(),
          Cookie: cookie,
        },
        body: JSON.stringify({ editToken: 'invalid_token_format' }),
      });

      assert.equal(res.status, 400);
      const json = (await res.json()) as { error: { message: string } };
      assert.match(json.error.message, /有効な特権管理トークン/);
    });

    test('存在しないドキュメントIDを指定した場合は 404 を返却すること。', async () => {
      const cookie = await getSessionCookie();
      const { app } = buildTestApp([]);

      const res = await app.request(`/api/documents/${dummySlug}/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': nextIp(),
          Cookie: cookie,
        },
        body: JSON.stringify({ editToken: generateCapabilityToken('edit') }),
      });

      assert.equal(res.status, 404);
      const json = (await res.json()) as { error: { message: string } };
      assert.match(json.error.message, /ドキュメントが見つかりません/);
    });

    test('論理削除済み(status = deleted)のドキュメントは 404 を返却すること。', async () => {
      const cookie = await getSessionCookie();
      const { doc, editToken } = await createFixtureDoc({ status: 'deleted' });
      const { app } = buildTestApp([doc]);

      const res = await app.request(`/api/documents/${dummySlug}/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': nextIp(),
          Cookie: cookie,
        },
        body: JSON.stringify({ editToken }),
      });

      assert.equal(res.status, 404);
    });

    test('通報規約違反で凍結中(status = suspended)のドキュメントは 403 で遮断すること。', async () => {
      const cookie = await getSessionCookie();
      const { doc, editToken } = await createFixtureDoc({
        status: 'suspended',
      });
      const { app } = buildTestApp([doc]);

      const res = await app.request(`/api/documents/${dummySlug}/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': nextIp(),
          Cookie: cookie,
        },
        body: JSON.stringify({ editToken }),
      });

      assert.equal(res.status, 403);
      const json = (await res.json()) as { error: { message: string } };
      assert.match(json.error.message, /通報により凍結されています/);
    });

    test('modifyToken で Claim を試みた場合は 403 で拒絶されること。', async () => {
      const cookie = await getSessionCookie();
      const { doc, modifyToken } = await createFixtureDoc();
      const { app } = buildTestApp([doc]);

      const res = await app.request(`/api/documents/${dummySlug}/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': nextIp(),
          Cookie: cookie,
        },
        body: JSON.stringify({ editToken: modifyToken }),
      });

      // modifyToken は EDIT_TOKEN_PATTERN にマッチしないためバリデーション400
      assert.equal(res.status, 400);
    });

    test('不一致の editToken で Claim を試みた場合は 403 で拒絶されること。', async () => {
      const cookie = await getSessionCookie();
      const { doc } = await createFixtureDoc();
      const { app } = buildTestApp([doc]);

      const dummyOtherEditToken = generateCapabilityToken('edit');

      const res = await app.request(`/api/documents/${dummySlug}/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': nextIp(),
          Cookie: cookie,
        },
        body: JSON.stringify({ editToken: dummyOtherEditToken }),
      });

      assert.equal(res.status, 403);
      const json = (await res.json()) as { error: { message: string } };
      assert.match(json.error.message, /操作を行う権限がありません/);
    });

    test('既に別のアカウントに移譲済みのドキュメントに対しては 409 Conflict を返却すること。', async () => {
      const cookie = await getSessionCookie();
      const { doc, editToken } = await createFixtureDoc({
        owner_user_id: otherUser.providerUserId,
        owner_provider: otherUser.provider,
      });
      const { app } = buildTestApp([doc]);

      const res = await app.request(`/api/documents/${dummySlug}/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': nextIp(),
          Cookie: cookie,
        },
        body: JSON.stringify({ editToken }),
      });

      assert.equal(res.status, 409);
      const json = (await res.json()) as { error: { message: string } };
      assert.match(json.error.message, /既に別のアカウントに所有されています/);
    });

    test('正当な editToken により匿名ドキュメントの所有権移譲が成功し 200 OK を返却すること。', async () => {
      const cookie = await getSessionCookie();
      const { doc, editToken } = await createFixtureDoc();
      const { app, documentsList } = buildTestApp([doc]);

      const res = await app.request(`/api/documents/${dummySlug}/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': nextIp(),
          Cookie: cookie,
        },
        body: JSON.stringify({ editToken }),
      });

      assert.equal(res.status, 200);
      assert.equal(res.headers.get('Cache-Control'), 'no-store');

      const json = (await res.json()) as DocumentClaimResponse;
      assert.equal(json.success, true);
      assert.equal(json.id, dummySlug);
      assert.equal(json.ownerUserId, mockUser.providerUserId);
      assert.equal(json.ownerProvider, mockUser.provider);

      // D1 レコードが更新されていること
      const updated = documentsList.find((d) => d.id === dummySlug);
      assert.equal(updated?.owner_user_id, mockUser.providerUserId);
      assert.equal(updated?.owner_provider, mockUser.provider);
    });

    test('同一ユーザーによる重複 Claim 実行時は冪等に 200 OK を返却すること。', async () => {
      const cookie = await getSessionCookie();
      const { doc, editToken } = await createFixtureDoc({
        owner_user_id: mockUser.providerUserId,
        owner_provider: mockUser.provider,
      });
      const { app } = buildTestApp([doc]);

      const res = await app.request(`/api/documents/${dummySlug}/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': nextIp(),
          Cookie: cookie,
        },
        body: JSON.stringify({ editToken }),
      });

      assert.equal(res.status, 200);
      const json = (await res.json()) as DocumentClaimResponse;
      assert.equal(json.success, true);
      assert.equal(json.ownerUserId, mockUser.providerUserId);
    });

    test('Authorization ヘッダーで editToken を指定した場合も正常に移譲できること。', async () => {
      const cookie = await getSessionCookie();
      const { doc, editToken } = await createFixtureDoc();
      const { app } = buildTestApp([doc]);

      const res = await app.request(`/api/documents/${dummySlug}/claim`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${editToken}`,
          'cf-connecting-ip': nextIp(),
          Cookie: cookie,
        },
      });

      assert.equal(res.status, 200);
      const json = (await res.json()) as DocumentClaimResponse;
      assert.equal(json.success, true);
      assert.equal(json.id, dummySlug);
    });
  });

  describe('GET /api/documents?mine=true (所有ドキュメント一覧)', () => {
    test('未ログイン状態での mine 要求は 401 を返却すること。', async () => {
      const { app } = buildTestApp([]);

      const res = await app.request('/api/documents?mine=true', {
        method: 'GET',
        headers: {
          'cf-connecting-ip': nextIp(),
        },
      });

      assert.equal(res.status, 401);
      const json = (await res.json()) as { error: { message: string } };
      assert.match(json.error.message, /ログインが必要です/);
    });

    test('ログイン中ユーザーが所有するドキュメント一覧を取得できること。', async () => {
      const cookie = await getSessionCookie();

      const { doc: myDoc1 } = await createFixtureDoc({
        id: 'MyDoc1111111',
        title: '自分のドキュメント1',
        owner_user_id: mockUser.providerUserId,
        owner_provider: mockUser.provider,
        visibility: 'public',
      });
      const { doc: myDoc2 } = await createFixtureDoc({
        id: 'MyDoc2222222',
        title: '自分のドキュメント2(限定公開)',
        owner_user_id: mockUser.providerUserId,
        owner_provider: mockUser.provider,
        visibility: 'unlisted',
      });
      const { doc: otherDoc } = await createFixtureDoc({
        id: 'OtherDoc3333',
        title: '他人のドキュメント',
        owner_user_id: otherUser.providerUserId,
        owner_provider: otherUser.provider,
        visibility: 'public',
      });

      const { app } = buildTestApp([myDoc1, myDoc2, otherDoc]);

      const res = await app.request('/api/documents?mine=true', {
        method: 'GET',
        headers: {
          'cf-connecting-ip': nextIp(),
          Cookie: cookie,
        },
      });

      assert.equal(res.status, 200);
      assert.equal(
        res.headers.get('Cache-Control'),
        'private, no-cache, no-store',
      );

      const json = (await res.json()) as DocumentListResponse;
      assert.equal(json.total, 2);
      assert.equal(json.items.length, 2);
      assert.equal(json.items[0]?.id, 'MyDoc1111111');
      assert.equal(json.items[1]?.id, 'MyDoc2222222');
    });
  });

  describe('所有権移譲後のハイブリッド認可 (アカウントセッションによる編集・削除)', () => {
    test('所有権移譲済みドキュメントは Bearer トークン無しでセッションにより削除できること。', async () => {
      const cookie = await getSessionCookie();
      const { doc } = await createFixtureDoc({
        owner_user_id: mockUser.providerUserId,
        owner_provider: mockUser.provider,
      });
      const { app, documentsList } = buildTestApp([doc]);

      const res = await app.request(`/api/documents/${dummySlug}`, {
        method: 'DELETE',
        headers: {
          'cf-connecting-ip': nextIp(),
          Cookie: cookie,
        },
      });

      assert.equal(res.status, 200);
      const target = documentsList.find((d) => d.id === dummySlug);
      assert.equal(target?.status, 'deleted');
    });

    test('別のアカウントのセッションでは Bearer トークン無しで削除しようとしても 401 で拒絶されること。', async () => {
      const cookie = await getSessionCookie(otherUser);
      const { doc } = await createFixtureDoc({
        owner_user_id: mockUser.providerUserId,
        owner_provider: mockUser.provider,
      });
      const { app } = buildTestApp([doc]);

      const res = await app.request(`/api/documents/${dummySlug}`, {
        method: 'DELETE',
        headers: {
          'cf-connecting-ip': nextIp(),
          Cookie: cookie,
        },
      });

      assert.equal(res.status, 401);
    });
  });
});
