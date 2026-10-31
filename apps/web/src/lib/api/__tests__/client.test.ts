import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getApiBaseUrl,
  requestUploadSign,
  uploadToR2,
  commitDocument,
  fetchDocument,
  fetchDocuments,
  verifyPasscode,
  claimDocument,
  fetchCurrentUser,
  reportDocument,
  logout,
  ApiError,
} from '../client';
import type {
  DocumentCommitRequest,
  DocumentCommitResponse,
  UploadSignFileItem,
  UploadSignResponse,
} from '@patto-md/shared';

describe('APIクライアント(src/lib/api/client.ts)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('getApiBaseUrl', () => {
    it('デフォルトのAPIベースURL(http://localhost:8787)を返却する。', () => {
      const url = getApiBaseUrl();
      expect(url).toBe('http://localhost:8787');
    });

    it('カスタムURLが注入されている場合はそれを優先する。', () => {
      (
        globalThis as unknown as { __PATTO_API_URL__?: string }
      ).__PATTO_API_URL__ = 'https://api.example.com/';
      expect(getApiBaseUrl()).toBe('https://api.example.com');
      delete (globalThis as unknown as { __PATTO_API_URL__?: string })
        .__PATTO_API_URL__;
    });
  });

  describe('requestUploadSign', () => {
    it('正常時に署名発行APIへPOSTリクエストを送信し、レスポンスを取得する。', async () => {
      const mockResponse: UploadSignResponse = {
        files: [
          {
            fileId: 'mock-uuid-1',
            fileName: 'test.png',
            r2Key: 'temp/uploads/mock-uuid-1/test.png',
            uploadUrl: 'https://r2.example.com/put-url',
          },
        ],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      } as Response);

      const items: UploadSignFileItem[] = [
        { name: 'test.png', size: 1024, type: 'image/png' },
      ];

      const result = await requestUploadSign(items, 'http://localhost:8787');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/upload/sign',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: items }),
        }),
      );
      expect(result).toEqual(mockResponse);
    });

    it('Turnstile トークンが渡された場合、署名APIのリクエストヘッダーに付与して送信する。', async () => {
      const mockResponse: UploadSignResponse = {
        files: [
          {
            fileId: 'mock-uuid-1',
            fileName: 'test.png',
            r2Key: 'temp/uploads/mock-uuid-1/test.png',
            uploadUrl: 'https://r2.example.com/put-url',
          },
        ],
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      } as Response);
      globalThis.fetch = fetchMock;

      const items: UploadSignFileItem[] = [
        { name: 'test.png', size: 1024, type: 'image/png' },
      ];

      const result = await requestUploadSign(
        items,
        'http://localhost:8787',
        'dummy-turnstile-token',
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8787/api/upload/sign',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-turnstile-token': 'dummy-turnstile-token',
          },
          body: JSON.stringify({ files: items }),
        },
      );
      expect(result).toEqual(mockResponse);
    });

    it('APIエラー時に適切なエラーメッセージを持ったApiErrorをthrowする。', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            message: 'ファイルメタデータの検証に失敗しました。',
          },
        }),
      } as Response);

      const items: UploadSignFileItem[] = [
        { name: 'test.png', size: 1024, type: 'image/png' },
      ];

      await expect(
        requestUploadSign(items, 'http://localhost:8787'),
      ).rejects.toThrow('ファイルメタデータの検証に失敗しました。');
    });
  });

  describe('uploadToR2', () => {
    it('Presigned PUT URLに対してContent-Typeヘッダーのみを付与してバイナリを送信する。', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      const blob = new Blob(['hello world'], { type: 'text/markdown' });
      await uploadToR2('https://r2.example.com/put-url', blob, 'text/markdown');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://r2.example.com/put-url',
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'text/markdown',
          },
          body: blob,
        },
      );
    });

    it('R2アップロード失敗時にApiErrorをthrowする。', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
      } as Response);

      const blob = new Blob(['test'], { type: 'image/png' });

      await expect(
        uploadToR2('https://r2.example.com/put-url', blob, 'image/png'),
      ).rejects.toThrow(ApiError);
    });
  });

  describe('commitDocument', () => {
    it('正常時にコミットAPIへPOST送信し、発行されたSlug・URLを受信する。', async () => {
      const mockResponse: DocumentCommitResponse = {
        id: 'AbCdEf123456',
        url: '/p/AbCdEf123456',
        title: 'テスト文書',
        editToken: 'pt_edt_0123456789abcdef0123456789abcdef0123456789a',
        modifyToken: 'pt_mod_0123456789abcdef0123456789abcdef0123456789a',
        expiresAt: '2026-11-05T00:00:00.000Z',
        createdAt: '2026-10-29T00:00:00.000Z',
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => mockResponse,
      } as Response);

      const payload: DocumentCommitRequest = {
        title: 'テスト文書',
        contentR2Key: 'temp/uploads/uuid/content.md',
        attachments: [],
        expiration: '7days',
      };

      const result = await commitDocument(payload, 'http://localhost:8787');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/documents',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
      );
      expect(result).toEqual(mockResponse);
    });

    it('コミットAPIがエラーを返却した場合にApiErrorをthrowする。', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({
          error: {
            message: 'データベースの書き込みに失敗しました。',
          },
        }),
      } as Response);

      const payload: DocumentCommitRequest = {
        title: 'テスト文書',
        contentR2Key: 'temp/uploads/uuid/content.md',
        attachments: [],
        expiration: '7days',
      };

      await expect(
        commitDocument(payload, 'http://localhost:8787'),
      ).rejects.toThrow('データベースの書き込みに失敗しました。');
    });
  });

  describe('fetchDocument', () => {
    it('正常時にドキュメント取得APIへGETリクエストを送信し、データとCache-Controlを取得する。', async () => {
      const mockDocument = {
        id: 'AbCdEf123456',
        title: '閲覧テスト文書',
        content: '# 見出し\n本文',
        status: 'published',
        expiresAt: '2026-11-01T00:00:00.000Z',
        createdAt: '2026-10-30T00:00:00.000Z',
        updatedAt: '2026-10-30T00:00:00.000Z',
        attachments: [],
      };

      const mockHeaders = new Headers();
      mockHeaders.set('cache-control', 'public, max-age=60, s-maxage=300');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: mockHeaders,
        json: async () => mockDocument,
      } as unknown as Response);

      const result = await fetchDocument(
        'AbCdEf123456',
        'http://localhost:8787',
      );

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/documents/AbCdEf123456',
        expect.objectContaining({
          method: 'GET',
        }),
      );
      expect(result.document).toEqual(mockDocument);
      expect(result.cacheControl).toBe('public, max-age=60, s-maxage=300');
    });

    it('存在しないまたは期限切れドキュメントの場合に404のApiErrorをthrowする。', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers(),
        json: async () => ({
          error: {
            message: 'ドキュメントが見つかりません。',
          },
        }),
      } as unknown as Response);

      await expect(
        fetchDocument('NotExist1234', 'http://localhost:8787'),
      ).rejects.toThrow('ドキュメントが見つかりません。');
    });

    it('`Cookie` オプションが指定された場合、リクエストヘッダーに `Cookie` を付与して送信する。', async () => {
      const mockDocument = {
        id: 'AbCdEf123456',
        title: 'テスト',
        content: '本文',
        visibility: 'protected',
        status: 'published',
        expiresAt: null,
        createdAt: '2026-10-30T00:00:00.000Z',
        updatedAt: '2026-10-30T00:00:00.000Z',
        attachments: [],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => mockDocument,
      } as unknown as Response);

      await fetchDocument('AbCdEf123456', 'http://localhost:8787', fetch, {
        cookie: 'patto_doc_auth_AbCdEf123456=dummy.jwt.token',
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/documents/AbCdEf123456',
        expect.objectContaining({
          method: 'GET',
          headers: {
            Cookie: 'patto_doc_auth_AbCdEf123456=dummy.jwt.token',
          },
        }),
      );
    });

    it('パスコード保護中で 401 が返却された場合、例外にならず保護情報を透過して返却する。', async () => {
      const protectedDoc = {
        id: 'ProtDoc12345',
        title: '保護された文書',
        content: '',
        visibility: 'protected',
        isProtected: true,
        status: 'published',
        expiresAt: null,
        createdAt: '2026-10-30T00:00:00.000Z',
        updatedAt: '2026-10-30T00:00:00.000Z',
        attachments: [],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers(),
        json: async () => ({
          error: {
            message: 'このドキュメントはパスコードで保護されています。',
          },
          document: protectedDoc,
        }),
      } as unknown as Response);

      const result = await fetchDocument(
        'ProtDoc12345',
        'http://localhost:8787',
      );

      expect(result.document).toEqual(protectedDoc);
      expect(result.document.isProtected).toBe(true);
      expect(result.cacheControl).toBe('private, no-cache, no-store');
    });
  });

  describe('`verifyPasscode`', () => {
    it('正常時にパスコード照合APIへ `POST` し、トークンレスポンスを取得する。', async () => {
      const mockResponse = {
        success: true,
        token: 'sample.jwt.token',
        expiresAt: '2026-11-01T00:00:00.000Z',
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => mockResponse,
      } as unknown as Response);

      const result = await verifyPasscode(
        'ProtDoc12345',
        'secret-pass',
        'http://localhost:8787',
      );

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/documents/ProtDoc12345/verify-passcode',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passcode: 'secret-pass' }),
        }),
      );
      expect(result).toEqual(mockResponse);
    });

    it('パスコード不一致時に 401 の `ApiError` を throw する。', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers(),
        json: async () => ({
          error: { message: 'パスコードが一致しません。' },
        }),
      } as unknown as Response);

      await expect(
        verifyPasscode('ProtDoc12345', 'wrong-pass', 'http://localhost:8787'),
      ).rejects.toThrow('パスコードが一致しません。');
    });
  });

  describe('fetchDocuments', () => {
    it('正常時にドキュメント一覧とキャッシュ制御ヘッダーを取得する。', async () => {
      const mockListResponse = {
        items: [
          {
            id: 'valid-slug-12',
            title: '一覧テスト',
            description: '抜粋テキスト',
            expiresAt: null,
            createdAt: '2026-10-30T00:00:00.000Z',
            attachmentCount: 2,
          },
        ],
        total: 1,
        page: 1,
        limit: 12,
        totalPages: 1,
      };

      const mockHeaders = new Headers();
      mockHeaders.set('Cache-Control', 'public, max-age=10');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: mockHeaders,
        json: async () => mockListResponse,
      } as unknown as Response);

      const result = await fetchDocuments({
        page: 2,
        limit: 10,
        ids: ['valid-slug-12'],
        baseUrl: 'http://localhost:8787',
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/documents?page=2&limit=10&ids=valid-slug-12',
        { method: 'GET' },
      );
      expect(result.data).toEqual(mockListResponse);
      expect(result.cacheControl).toBe('public, max-age=10');
    });

    it('mine: true 指定時にクエリパラメータと credentials: include を付与してリクエストする。', async () => {
      const mockListResponse = {
        items: [],
        total: 0,
        page: 1,
        limit: 12,
        totalPages: 0,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => mockListResponse,
      } as unknown as Response);

      await fetchDocuments({
        mine: true,
        baseUrl: 'http://localhost:8787',
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/documents?mine=true',
        { method: 'GET', credentials: 'include' },
      );
    });

    it('APIエラー時に適切な `ApiError` を送出する。', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
        json: async () => ({
          error: { message: '一覧取得エラー。' },
        }),
      } as unknown as Response);

      await expect(fetchDocuments()).rejects.toThrow('一覧取得エラー。');
    });
  });

  describe('claimDocument', () => {
    it('正常時に所有権移譲APIへPOSTリクエストを送信し、レスポンスを取得する。', async () => {
      const mockResponse = {
        success: true,
        id: 'valid-slug-12',
        ownerUserId: 'gh-12345',
        ownerProvider: 'github',
        updatedAt: '2026-10-31T00:00:00.000Z',
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      } as unknown as Response);

      const result = await claimDocument(
        'valid-slug-12',
        'pt_edt_testtoken12345',
        'http://localhost:8787',
      );

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/documents/valid-slug-12/claim',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ editToken: 'pt_edt_testtoken12345' }),
        }),
      );
      expect(result).toEqual(mockResponse);
    });

    it('所有権移譲APIエラー時に `ApiError` を送出する。', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          error: {
            message: 'このドキュメントは既に別のアカウントに所有されています。',
          },
        }),
      } as unknown as Response);

      await expect(
        claimDocument(
          'valid-slug-12',
          'pt_edt_testtoken12345',
          'http://localhost:8787',
        ),
      ).rejects.toThrow(
        'このドキュメントは既に別のアカウントに所有されています。',
      );
    });
  });

  describe('fetchCurrentUser', () => {
    it('認証済みユーザー情報が存在する場合、ユーザーオブジェクトを返却する。', async () => {
      const mockUser = {
        provider: 'github',
        providerUserId: '12345',
        username: 'octocat',
        avatarUrl: null,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ user: mockUser }),
      } as unknown as Response);

      const user = await fetchCurrentUser('http://localhost:8787');
      expect(user).toEqual(mockUser);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/auth/me',
        { method: 'GET', credentials: 'include' },
      );
    });

    it('未認証時は null を返却する。', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ user: null }),
      } as unknown as Response);

      const user = await fetchCurrentUser('http://localhost:8787');
      expect(user).toBeNull();
    });
  });

  describe('logout', () => {
    it('正常時にログアウトAPIへPOSTリクエストを送信する。', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as unknown as Response);

      const result = await logout('http://localhost:8787');
      expect(result).toEqual({ success: true });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/auth/logout',
        { method: 'POST', credentials: 'include' },
      );
    });
  });

  describe('reportDocument', () => {
    it('正常時に通報APIへPOSTリクエストを送信し、結果を取得する。', async () => {
      const mockResponse = {
        success: true,
        message: '通報を受け付けました。',
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      } as unknown as Response);

      const result = await reportDocument(
        'AbCdEf123456',
        {
          reason: 'phishing',
          details: '不審なリンクが含まれています。',
        },
        'dummy-turnstile-token',
        'http://localhost:8787',
      );

      expect(result).toEqual(mockResponse);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/documents/AbCdEf123456/report',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-turnstile-token': 'dummy-turnstile-token',
          },
          body: JSON.stringify({
            reason: 'phishing',
            details: '不審なリンクが含まれています。',
          }),
        },
      );
    });

    it('APIエラー時に適切なエラーメッセージを含む ApiError を投げる。', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: { message: '入力内容に誤りがあります。' },
        }),
      } as unknown as Response);

      await expect(
        reportDocument(
          'AbCdEf123456',
          { reason: 'spam' },
          'dummy-token',
          'http://localhost:8787',
        ),
      ).rejects.toThrow('入力内容に誤りがあります。');
    });
  });
});
