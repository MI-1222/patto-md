import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getApiBaseUrl,
  requestUploadSign,
  uploadToR2,
  commitDocument,
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
});
