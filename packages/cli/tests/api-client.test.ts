import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commitDocument,
  fetchCurrentUser,
  requestUploadSign,
  resolveApiUrl,
  resolveFrontendUrl,
  uploadDirectToR2,
  verifyPatConnectivity,
} from '../src/lib/api-client.ts';

describe('CLI API クライアント (lib/api-client.ts)', () => {
  const mockPat = 'pmd_pat_test1111111111111111111111111111111111111';
  const apiUrl = 'http://localhost:8787';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete process.env.PATTO_API_URL;
    delete process.env.PATTO_FRONTEND_URL;
  });

  describe('URL解決', () => {
    it('CLI引数が指定されている場合に最優先で採用すること。', async () => {
      process.env.PATTO_API_URL = 'http://env.api';
      const resolved = await resolveApiUrl('http://cli.api');
      expect(resolved).toBe('http://cli.api');
    });

    it('引数未指定時に環境変数を採用すること。', async () => {
      process.env.PATTO_API_URL = 'http://env.api/';
      const resolved = await resolveApiUrl();
      expect(resolved).toBe('http://env.api');
    });

    it('未設定時にデフォルトのlocalhostを採用すること。', async () => {
      const resolved = await resolveApiUrl();
      expect(resolved).toBe('http://localhost:8787');
    });

    it('フロントエンドURLを適切に解決すること。', async () => {
      const resolvedLocal = await resolveFrontendUrl(
        undefined,
        'http://localhost:8787',
      );
      expect(resolvedLocal).toBe('http://localhost:4321');

      const resolvedProd = await resolveFrontendUrl(
        undefined,
        'https://patto-md-api.example-user.workers.dev',
      );
      expect(resolvedProd).toBe(
        'https://patto-md-web.example-user.workers.dev',
      );
    });
  });

  describe('requestUploadSign', () => {
    it('正当なヘッダーおよびペイロードでPOSTリクエストを送信すること。', async () => {
      const mockResponseData = {
        files: [
          {
            fileId: 'file-1',
            r2Key: 'exp-7d/file-1.md',
            uploadUrl: 'https://r2.example.com/put-md',
          },
        ],
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponseData,
      });
      globalThis.fetch = fetchMock;

      const result = await requestUploadSign(
        [{ name: 'readme.md', size: 100, type: 'text/markdown' }],
        '7days',
        mockPat,
        apiUrl,
      );

      expect(fetchMock).toHaveBeenCalledWith(`${apiUrl}/api/upload/sign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${mockPat}`,
        },
        body: JSON.stringify({
          files: [{ name: 'readme.md', size: 100, type: 'text/markdown' }],
          expiration: '7days',
        }),
      });

      expect(result).toEqual(mockResponseData);
    });

    it('APIエラー時に適切なステータスコードとエラーメッセージで例外をスローすること。', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: '認証に失敗しました。' } }),
      });

      await expect(
        requestUploadSign([], '7days', mockPat, apiUrl),
      ).rejects.toThrow('認証に失敗しました。');
    });
  });

  describe('uploadDirectToR2', () => {
    it('Presigned PUT送信時にAuthorization等の余計なヘッダーを付与しないこと。', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
      });
      globalThis.fetch = fetchMock;

      const buffer = Buffer.from('test-image-binary');
      await uploadDirectToR2(
        'https://r2.example.com/signed-put-url',
        buffer,
        'image/png',
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'https://r2.example.com/signed-put-url',
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'image/png',
          },
          body: buffer,
        },
      );
    });

    it('R2アップロード失敗時に例外をスローすること。', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
      });

      await expect(
        uploadDirectToR2(
          'https://r2.example.com/put',
          Buffer.from('test'),
          'image/png',
        ),
      ).rejects.toThrow('ストレージへのアップロードに失敗しました(403)。');
    });
  });

  describe('commitDocument', () => {
    it('正当なヘッダーおよびペイロードでコミット要求を送信すること。', async () => {
      const mockCommitResponse = {
        id: 'slug12345678',
        url: '/p/slug12345678',
        title: 'ドキュメントタイトル',
        createdAt: new Date().toISOString(),
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockCommitResponse,
      });
      globalThis.fetch = fetchMock;

      const payload = {
        title: 'ドキュメントタイトル',
        contentR2Key: 'exp-7d/content.md',
        attachments: [],
        expiration: '7days' as const,
        visibility: 'unlisted' as const,
      };

      const result = await commitDocument(payload, mockPat, apiUrl);

      expect(fetchMock).toHaveBeenCalledWith(`${apiUrl}/api/documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${mockPat}`,
        },
        body: JSON.stringify(payload),
      });

      expect(result).toEqual(mockCommitResponse);
    });
  });

  describe('fetchCurrentUser & verifyPatConnectivity', () => {
    it('GET /api/auth/me に正当なPATを送信しユーザー情報を取得できること。', async () => {
      const mockUser = {
        provider: 'github' as const,
        providerUserId: '12345',
        username: 'octocat',
        avatarUrl: null,
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          user: mockUser,
          scopes: ['documents:read', 'documents:write'],
          tokenName: 'Test PAT',
        }),
      });
      globalThis.fetch = fetchMock;

      const user = await fetchCurrentUser(mockPat, apiUrl);

      expect(fetchMock).toHaveBeenCalledWith(`${apiUrl}/api/auth/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${mockPat}`,
        },
      });

      expect(user).toEqual({
        ...mockUser,
        scopes: ['documents:read', 'documents:write'],
        tokenName: 'Test PAT',
      });

      const isConnected = await verifyPatConnectivity(mockPat, apiUrl);
      expect(isConnected).toBe(true);
    });

    it('未認証または無効なPATの場合に null / false を返却すること。', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ user: null }),
      });

      const user = await fetchCurrentUser('invalid_pat', apiUrl);
      expect(user).toBeNull();

      const isConnected = await verifyPatConnectivity('invalid_pat', apiUrl);
      expect(isConnected).toBe(false);
    });

    it('ネットワークエラー発生時に安全に null / false を返却すること。', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const user = await fetchCurrentUser(mockPat, apiUrl);
      expect(user).toBeNull();

      const isConnected = await verifyPatConnectivity(mockPat, apiUrl);
      expect(isConnected).toBe(false);
    });
  });
});
