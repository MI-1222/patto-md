import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { Hono } from 'hono';
import {
  generateCapabilityToken,
  hashToken,
  TURNSTILE_TEST_SECRET_KEY_BLOCK,
  TURNSTILE_TEST_SECRET_KEY_PASS,
  TURNSTILE_TOKEN_HEADER,
  type AbuseReportRecord,
  type DocumentReportResponse,
} from '@patto-md/shared';

import { documentsRouter } from '../src/routes/documents.ts';
import type { AppEnv, AuthenticatedDocument } from '../src/types.ts';

describe('ドキュメント通報API(POST /api/documents/:id/report)および凍結制御', () => {
  const dummySlug = 'AbCdEf123456';
  const dummySecret = 'test-jwt-secret-key-32-chars-long!!';
  let ipCounter = 1;

  const nextIp = () => `198.51.100.${ipCounter++}`;

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
      title: 'テスト対象ドキュメント',
      description: '要約テスト',
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
    initialReports: AbuseReportRecord[] = [],
    turnstileSecretKey: string = TURNSTILE_TEST_SECRET_KEY_PASS,
  ) {
    const documentsList = docs.map((d) => ({ ...d }));
    const abuseReportsList = initialReports.map((r) => ({ ...r }));

    const mockDb = {
      prepare: (query: string) => ({
        bind: (...args: unknown[]) => ({
          first: async <T>() => {
            if (
              query.includes('FROM documents') &&
              query.includes('WHERE id = ?')
            ) {
              const targetId = args[0] as string;
              const found = documentsList.find((d) => d.id === targetId);
              return (found ? { ...found } : null) as T;
            }

            if (
              query.includes('FROM abuse_reports') &&
              query.includes('WHERE document_id = ?') &&
              query.includes('reporter_ip_hash = ?')
            ) {
              const docId = args[0] as string;
              const ipHash = args[1] as string;
              const found = abuseReportsList.find(
                (r) => r.document_id === docId && r.reporter_ip_hash === ipHash,
              );
              return (found ? { id: found.id } : null) as T;
            }

            return null as T;
          },
          run: async () => {
            if (
              query.includes('INSERT INTO abuse_reports') ||
              query.includes('INSERT OR IGNORE INTO abuse_reports')
            ) {
              const docId = args[0] as string;
              const ipHash = args[1] as string;
              const reason = args[2] as string;
              const createdAt = args[3] as string;

              const existing = abuseReportsList.find(
                (r) => r.document_id === docId && r.reporter_ip_hash === ipHash,
              );
              if (existing) {
                return { success: true, meta: { changes: 0 } };
              }

              abuseReportsList.push({
                id: abuseReportsList.length + 1,
                document_id: docId,
                reporter_ip_hash: ipHash,
                reason,
                created_at: createdAt,
              });
              return { success: true, meta: { changes: 1 } };
            }

            if (
              query.includes('UPDATE documents') &&
              query.includes("status = 'deleted'")
            ) {
              const targetId = args[1] as string;
              const found = documentsList.find((d) => d.id === targetId);
              if (found) {
                found.status = 'deleted';
                return { success: true, meta: { changes: 1 } };
              }
              return { success: true, meta: { changes: 0 } };
            }

            return { success: true, meta: { changes: 0 } };
          },
        }),
      }),
      batch: async () => [],
    };

    const mockBucket = {
      head: async () => ({ size: 100 }),
      get: async () => null,
      put: async () => {},
      delete: async () => {},
    };

    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.env = {
        DB: mockDb as unknown as D1Database,
        BUCKET: mockBucket as unknown as R2Bucket,
        JWT_SECRET: dummySecret,
        TURNSTILE_SECRET_KEY: turnstileSecretKey,
      } as AppEnv['Bindings'];
      await next();
    });

    app.route('/api/documents', documentsRouter);

    return { app, documentsList, abuseReportsList };
  }

  test('Turnstile トークンが存在しない場合は 400 で拒絶される。', async () => {
    const { doc } = await createFixtureDoc();
    const { app } = buildTestApp([doc]);

    const res = await app.request(`/api/documents/${dummySlug}/report`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': nextIp(),
      },
      body: JSON.stringify({
        reason: 'spam',
      }),
    });

    assert.equal(res.status, 400);
  });

  test('Turnstile 検証に失敗した場合は 403 で拒絶される。', async () => {
    const { doc } = await createFixtureDoc();
    const { app } = buildTestApp([doc], [], TURNSTILE_TEST_SECRET_KEY_BLOCK);

    const res = await app.request(`/api/documents/${dummySlug}/report`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [TURNSTILE_TOKEN_HEADER]: 'dummy-invalid-token',
        'cf-connecting-ip': nextIp(),
      },
      body: JSON.stringify({
        reason: 'spam',
      }),
    });

    assert.equal(res.status, 403);
  });

  test('不正な Slug 形式の場合は 404 が返却される。', async () => {
    const { app } = buildTestApp([]);

    const res = await app.request('/api/documents/invalid-slug/report', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [TURNSTILE_TOKEN_HEADER]: 'dummy-pass-token',
        'cf-connecting-ip': nextIp(),
      },
      body: JSON.stringify({
        reason: 'spam',
      }),
    });

    assert.equal(res.status, 404);
  });

  test('存在しないドキュメントまたは削除済みドキュメントへの通報は 404 が返却される。', async () => {
    const { doc } = await createFixtureDoc({ status: 'deleted' });
    const { app } = buildTestApp([doc]);

    const res = await app.request(`/api/documents/${dummySlug}/report`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [TURNSTILE_TOKEN_HEADER]: 'dummy-pass-token',
        'cf-connecting-ip': nextIp(),
      },
      body: JSON.stringify({
        reason: 'spam',
      }),
    });

    assert.equal(res.status, 404);
  });

  test('不正な通報理由またはバリデーションエラーの場合は 400 が返却される。', async () => {
    const { doc } = await createFixtureDoc();
    const { app } = buildTestApp([doc]);

    const res = await app.request(`/api/documents/${dummySlug}/report`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [TURNSTILE_TOKEN_HEADER]: 'dummy-pass-token',
        'cf-connecting-ip': nextIp(),
      },
      body: JSON.stringify({
        reason: 'invalid_reason_type',
      }),
    });

    assert.equal(res.status, 400);
  });

  test('正常な通報を受信した場合、200 OK が返却され D1 に記録される。', async () => {
    const { doc } = await createFixtureDoc();
    const { app, abuseReportsList } = buildTestApp([doc]);
    const ip = nextIp();

    const res = await app.request(`/api/documents/${dummySlug}/report`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [TURNSTILE_TOKEN_HEADER]: 'dummy-pass-token',
        'cf-connecting-ip': ip,
      },
      body: JSON.stringify({
        reason: 'phishing',
        details: '不審なログイン画面へのリンクが含まれています。',
      }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as DocumentReportResponse;
    assert.equal(body.success, true);
    assert.equal(body.message, '通報を受け付けました。');

    assert.equal(abuseReportsList.length, 1);
    assert.equal(abuseReportsList[0].document_id, dummySlug);
    assert.match(
      abuseReportsList[0].reason ?? '',
      /phishing: 不審なログイン画面/,
    );
    assert.ok(abuseReportsList[0].reporter_ip_hash.length === 64);
  });

  test('同一IPからの重複通報は水増しを防ぐため再登録されず、冪等に 200 OK が返却される。', async () => {
    const { doc } = await createFixtureDoc();
    const { app, abuseReportsList } = buildTestApp([doc]);
    const sameIp = nextIp();

    // 1回目の通報。
    const res1 = await app.request(`/api/documents/${dummySlug}/report`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [TURNSTILE_TOKEN_HEADER]: 'dummy-pass-token',
        'cf-connecting-ip': sameIp,
      },
      body: JSON.stringify({
        reason: 'spam',
      }),
    });
    assert.equal(res1.status, 200);
    assert.equal(abuseReportsList.length, 1);

    // 同一IPからの2回目の通報。
    const res2 = await app.request(`/api/documents/${dummySlug}/report`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [TURNSTILE_TOKEN_HEADER]: 'dummy-pass-token',
        'cf-connecting-ip': sameIp,
      },
      body: JSON.stringify({
        reason: 'spam',
        details: '重複通報テスト',
      }),
    });
    assert.equal(res2.status, 200);
    // リストの件数は1件のままであること。
    assert.equal(abuseReportsList.length, 1);
  });

  test('既に凍結(status = suspended)されているドキュメントへの通報は、再登録せず 200 OK を返却する。', async () => {
    const { doc } = await createFixtureDoc({ status: 'suspended' });
    const { app, abuseReportsList } = buildTestApp([doc]);

    const res = await app.request(`/api/documents/${dummySlug}/report`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [TURNSTILE_TOKEN_HEADER]: 'dummy-pass-token',
        'cf-connecting-ip': nextIp(),
      },
      body: JSON.stringify({
        reason: 'spam',
      }),
    });

    assert.equal(res.status, 200);
    assert.equal(abuseReportsList.length, 0);
  });

  test('凍結(status = suspended)ドキュメントに対し、特権 editToken 保持者は自主取り下げ(DELETE)が可能である。', async () => {
    const { doc, editToken } = await createFixtureDoc({
      status: 'suspended',
    });
    const { app, documentsList } = buildTestApp([doc]);

    const res = await app.request(`/api/documents/${dummySlug}`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${editToken}`,
        'cf-connecting-ip': nextIp(),
      },
    });

    assert.equal(res.status, 200);
    const target = documentsList.find((d) => d.id === dummySlug);
    assert.equal(target?.status, 'deleted');
  });

  test('凍結(status = suspended)ドキュメントに対し、本文更新(PUT)や再公開(renew)は特権保持者であっても 403 で遮断される。', async () => {
    const { doc, editToken } = await createFixtureDoc({
      status: 'suspended',
    });
    const { app } = buildTestApp([doc]);

    const resPut = await app.request(`/api/documents/${dummySlug}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${editToken}`,
        'content-type': 'application/json',
        'cf-connecting-ip': nextIp(),
      },
      body: JSON.stringify({
        title: '新タイトル',
        contentR2Key: 'temp/uploads/valid-uuid/content.md',
        attachments: [],
      }),
    });
    assert.equal(resPut.status, 403);

    const resRenew = await app.request(`/api/documents/${dummySlug}/renew`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${editToken}`,
        'content-type': 'application/json',
        'cf-connecting-ip': nextIp(),
      },
      body: JSON.stringify({
        expiration: '7days',
      }),
    });
    assert.equal(resRenew.status, 403);
  });
});
