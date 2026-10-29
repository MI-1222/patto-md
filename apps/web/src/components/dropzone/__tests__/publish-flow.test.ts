import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseMarkdown } from '../../../lib/markdown/parser';
import { reconcileAssets } from '../../../lib/markdown/reconcile';
import type { ParsedFiles, VirtualFile } from '../types';
import {
  executePublishPipeline,
  resolveFileMimeType,
  type PublishProgressInfo,
} from '../../../lib/api/publish';
import type {
  UploadSignResponse,
  DocumentCommitResponse,
} from '@patto-md/shared';

/**
 * テスト用の仮想ファイルオブジェクトを生成する。
 *
 * @param relativePath - 相対パス。
 * @param content - ファイル本文。
 * @param type - MIMEタイプ。
 * @returns 仮想ファイルオブジェクト。
 */
function createVirtualFile(
  relativePath: string,
  content = 'image-binary',
  type = 'image/png',
): VirtualFile {
  const fileName = relativePath.split('/').pop() || 'test.png';
  return {
    file: new File([content], fileName, { type }),
    relativePath,
    isSizeExceeded: false,
    isTypeUnsupported: false,
  };
}

describe('Direct Uploadとコミットパイプラインの統合フロー検証', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('解決済み画像とMarkdownがR2へ並列アップロードされ、コミットまで完了すること', async () => {
    const mdContent = `
# システム仕様書
アーキテクチャ図:
![構成図](images/arch.png)
補足画像:
![詳細](sub/detail.png)
`;
    const markdownVirtualFile: VirtualFile = {
      file: new File([mdContent], 'spec.md', { type: 'text/markdown' }),
      relativePath: 'spec.md',
      isSizeExceeded: false,
      isTypeUnsupported: false,
    };

    const assetFiles = new Map<string, VirtualFile>([
      ['images/arch.png', createVirtualFile('images/arch.png')],
      ['sub/detail.png', createVirtualFile('sub/detail.png')],
      ['extra.png', createVirtualFile('extra.png')],
    ]);

    const parsedFiles: ParsedFiles = {
      markdownFile: markdownVirtualFile,
      assetFiles,
      totalSize: 5000,
      isTotalSizeExceeded: false,
      hasInvalidFiles: false,
    };

    const parseResult = await parseMarkdown(mdContent, {
      basePath: 'spec.md',
      fallbackTitle: 'spec',
    });

    const reconciliation = reconcileAssets(parseResult.imageRefs, assetFiles);
    expect(reconciliation.isComplete).toBe(true);
    expect(reconciliation.unused.length).toBe(1);

    const putCalls: { url: string; headers: unknown; body: unknown }[] = [];

    globalThis.fetch = vi
      .fn()
      .mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes('/api/upload/sign')) {
          const body = JSON.parse(init?.body as string) as {
            files: { name: string; size: number; type: string }[];
          };

          const response: UploadSignResponse = {
            files: body.files.map((f, i) => ({
              fileId: `uuid-${i + 1}`,
              fileName: f.name,
              r2Key: `temp/uploads/uuid-${i + 1}/${f.name}`,
              uploadUrl: `https://r2.example.com/put-${i + 1}`,
            })),
          };

          return {
            ok: true,
            status: 200,
            json: async () => response,
          } as Response;
        }

        if (url.startsWith('https://r2.example.com/put-')) {
          putCalls.push({
            url,
            headers: init?.headers,
            body: init?.body,
          });
          return {
            ok: true,
            status: 200,
          } as Response;
        }

        if (url.includes('/api/documents')) {
          const commitBody = JSON.parse(init?.body as string);
          const response: DocumentCommitResponse = {
            id: 'testSlug123',
            url: '/p/testSlug123',
            title: commitBody.title,
            expiresAt: '2026-11-05T00:00:00.000Z',
            createdAt: '2026-10-29T00:00:00.000Z',
          };

          return {
            ok: true,
            status: 201,
            json: async () => response,
          } as Response;
        }

        return {
          ok: false,
          status: 404,
        } as Response;
      });

    const progressLogs: PublishProgressInfo[] = [];

    const commitResult = await executePublishPipeline({
      parsedFiles,
      reconciliation,
      parseResult,
      markdownContent: mdContent,
      expiration: '7days',
      allowIncompletePublish: false,
      baseUrl: 'http://localhost:8787',
      onProgress: (p) => {
        progressLogs.push(p);
      },
    });

    expect(commitResult).not.toBeNull();
    expect(commitResult.id).toBe('testSlug123');
    expect(commitResult.url).toBe('/p/testSlug123');
    expect(commitResult.title).toBe('システム仕様書');

    expect(progressLogs.some((p) => p.stage === 'signing')).toBe(true);
    expect(progressLogs.some((p) => p.stage === 'uploading')).toBe(true);
    expect(progressLogs.some((p) => p.stage === 'committing')).toBe(true);

    const signCall = vi
      .mocked(globalThis.fetch)
      .mock.calls.find((call) => String(call[0]).includes('/api/upload/sign'));
    expect(signCall).toBeDefined();
    const signPayload = JSON.parse(signCall![1]?.body as string);
    expect(signPayload.files.length).toBe(3);
    expect(signPayload.files.map((f: { name: string }) => f.name)).toEqual([
      'arch.png',
      'detail.png',
      'spec.md',
    ]);

    expect(putCalls.length).toBe(3);

    expect(putCalls[0].headers).toEqual({ 'Content-Type': 'image/png' });
    expect(putCalls[1].headers).toEqual({ 'Content-Type': 'image/png' });
    expect(putCalls[2].headers).toEqual({ 'Content-Type': 'text/markdown' });

    const uploadedBlob = putCalls[2].body as Blob;
    const uploadedText = await uploadedBlob.text();
    expect(uploadedText).toContain('/api/assets/temp/uploads/uuid-1/arch.png');
    expect(uploadedText).toContain(
      '/api/assets/temp/uploads/uuid-2/detail.png',
    );
    expect(uploadedText).not.toContain('images/arch.png');
    expect(uploadedText).not.toContain('sub/detail.png');

    const commitCall = vi
      .mocked(globalThis.fetch)
      .mock.calls.find((call) => String(call[0]).includes('/api/documents'));
    expect(commitCall).toBeDefined();
    const commitPayload = JSON.parse(commitCall![1]?.body as string);
    expect(commitPayload.title).toBe('システム仕様書');
    expect(commitPayload.contentR2Key).toBe('temp/uploads/uuid-3/spec.md');
    expect(commitPayload.expiration).toBe('7days');
    expect(commitPayload.attachments.length).toBe(2);
    expect(commitPayload.attachments[0].r2Key).toBe(
      'temp/uploads/uuid-1/arch.png',
    );
    expect(commitPayload.attachments[1].r2Key).toBe(
      'temp/uploads/uuid-2/detail.png',
    );
  });

  it('未解決画像が存在し、allowIncompletePublishがfalseの場合は例外を投げて中断すること', async () => {
    const mdContent = '# テスト\n![存在しない画像](missing.png)';
    const markdownVirtualFile: VirtualFile = {
      file: new File([mdContent], 'test.md', { type: 'text/markdown' }),
      relativePath: 'test.md',
      isSizeExceeded: false,
      isTypeUnsupported: false,
    };

    const parsedFiles: ParsedFiles = {
      markdownFile: markdownVirtualFile,
      assetFiles: new Map(),
      totalSize: 100,
      isTotalSizeExceeded: false,
      hasInvalidFiles: false,
    };

    const parseResult = await parseMarkdown(mdContent);
    const reconciliation = reconcileAssets(parseResult.imageRefs, new Map());
    expect(reconciliation.isComplete).toBe(false);

    await expect(
      executePublishPipeline({
        parsedFiles,
        reconciliation,
        parseResult,
        markdownContent: mdContent,
        expiration: '1day',
        allowIncompletePublish: false,
      }),
    ).rejects.toThrow('未解決の画像が存在します。');
  });

  it('未解決画像が存在しても、allowIncompletePublishがtrueの場合は公開が成功すること', async () => {
    const mdContent = `
# 容認テスト
![存在する画像](images/exists.png)
![存在しない画像](images/missing.png)
`;
    const markdownVirtualFile: VirtualFile = {
      file: new File([mdContent], 'doc.md', { type: 'text/markdown' }),
      relativePath: 'doc.md',
      isSizeExceeded: false,
      isTypeUnsupported: false,
    };

    const assetFiles = new Map<string, VirtualFile>([
      ['images/exists.png', createVirtualFile('images/exists.png')],
    ]);

    const parsedFiles: ParsedFiles = {
      markdownFile: markdownVirtualFile,
      assetFiles,
      totalSize: 500,
      isTotalSizeExceeded: false,
      hasInvalidFiles: false,
    };

    const parseResult = await parseMarkdown(mdContent);
    const reconciliation = reconcileAssets(parseResult.imageRefs, assetFiles);
    expect(reconciliation.isComplete).toBe(false);
    expect(reconciliation.resolved.size).toBe(1);
    expect(reconciliation.missing.length).toBe(1);

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/upload/sign')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            files: [
              {
                fileId: 'uuid-img-1',
                fileName: 'exists.png',
                r2Key: 'temp/uploads/uuid-img-1/exists.png',
                uploadUrl: 'https://r2.example.com/put-1',
              },
              {
                fileId: 'uuid-md',
                fileName: 'doc.md',
                r2Key: 'temp/uploads/uuid-md/doc.md',
                uploadUrl: 'https://r2.example.com/put-2',
              },
            ],
          }),
        } as Response;
      }
      if (url.startsWith('https://r2.example.com/put-')) {
        return { ok: true, status: 200 } as Response;
      }
      if (url.includes('/api/documents')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'partialSlug',
            url: '/p/partialSlug',
            title: '容認テスト',
            expiresAt: null,
            createdAt: '2026-10-29T00:00:00.000Z',
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    const result = await executePublishPipeline({
      parsedFiles,
      reconciliation,
      parseResult,
      markdownContent: mdContent,
      expiration: 'never',
      allowIncompletePublish: true,
      baseUrl: 'http://localhost:8787',
    });

    expect(result).not.toBeNull();
    expect(result.id).toBe('partialSlug');
  });

  it('R2アップロードが失敗した場合、コミットAPIを呼ばずに例外を投げること', async () => {
    const mdContent = '# エラー検証';
    const markdownVirtualFile: VirtualFile = {
      file: new File([mdContent], 'test.md', { type: 'text/markdown' }),
      relativePath: 'test.md',
      isSizeExceeded: false,
      isTypeUnsupported: false,
    };

    const parsedFiles: ParsedFiles = {
      markdownFile: markdownVirtualFile,
      assetFiles: new Map(),
      totalSize: 100,
      isTotalSizeExceeded: false,
      hasInvalidFiles: false,
    };

    const parseResult = await parseMarkdown(mdContent);
    const reconciliation = reconcileAssets(parseResult.imageRefs, new Map());

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/upload/sign')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            files: [
              {
                fileId: 'uuid-md',
                fileName: 'test.md',
                r2Key: 'temp/uploads/uuid-md/test.md',
                uploadUrl: 'https://r2.example.com/put-fail',
              },
            ],
          }),
        } as Response;
      }
      if (url.startsWith('https://r2.example.com/put-fail')) {
        return { ok: false, status: 500 } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    await expect(
      executePublishPipeline({
        parsedFiles,
        reconciliation,
        parseResult,
        markdownContent: mdContent,
        expiration: '1day',
        allowIncompletePublish: false,
        baseUrl: 'http://localhost:8787',
      }),
    ).rejects.toThrow();

    const commitCall = vi
      .mocked(globalThis.fetch)
      .mock.calls.find((call) => String(call[0]).includes('/api/documents'));
    expect(commitCall).toBeUndefined();
  });

  describe('resolveFileMimeType の空文字列フォールバック検証', () => {
    it('file.type が空文字列の場合でも拡張子から適切なMIMEタイプを推定すること', () => {
      const pngFile = new File(['dummy'], 'diagram.png', { type: '' });
      expect(resolveFileMimeType(pngFile)).toBe('image/png');

      const jpegFile = new File(['dummy'], 'photo.jpeg', { type: '' });
      expect(resolveFileMimeType(jpegFile)).toBe('image/jpeg');

      const jpgFile = new File(['dummy'], 'photo.jpg', { type: '' });
      expect(resolveFileMimeType(jpgFile)).toBe('image/jpeg');

      const svgFile = new File(['dummy'], 'icon.svg', { type: '' });
      expect(resolveFileMimeType(svgFile)).toBe('image/svg+xml');

      const webpFile = new File(['dummy'], 'banner.webp', { type: '' });
      expect(resolveFileMimeType(webpFile)).toBe('image/webp');

      const gifFile = new File(['dummy'], 'anim.gif', { type: '' });
      expect(resolveFileMimeType(gifFile)).toBe('image/gif');

      const mdFile = new File(['dummy'], 'README.md', { type: '' });
      expect(resolveFileMimeType(mdFile)).toBe('text/markdown');
    });

    it('file.type が正常に設定されている場合はその値を維持すること', () => {
      const pngFile = new File(['dummy'], 'sample.png', { type: 'image/png' });
      expect(resolveFileMimeType(pngFile)).toBe('image/png');
    });

    it('拡張子から判定できない場合は指定されたフォールバック値を使用すること', () => {
      const unknownFile = new File(['dummy'], 'unknown_file', { type: '' });
      expect(resolveFileMimeType(unknownFile, 'image/png')).toBe('image/png');
    });

    it('file.typeが空文字のファイルを含むドキュメントが正常に署名・アップロードされること', async () => {
      const mdContent = '# 空MIMEタイプ検証\n![アイコン](icons/logo.svg)';
      const mdFile = new File([mdContent], 'doc.md', { type: '' });
      const svgFile = new File(['<svg></svg>'], 'logo.svg', { type: '' });

      const markdownVirtualFile: VirtualFile = {
        file: mdFile,
        relativePath: 'doc.md',
        isSizeExceeded: false,
        isTypeUnsupported: false,
      };

      const assetFiles = new Map<string, VirtualFile>([
        [
          'icons/logo.svg',
          {
            file: svgFile,
            relativePath: 'icons/logo.svg',
            isSizeExceeded: false,
            isTypeUnsupported: false,
          },
        ],
      ]);

      const parsedFiles: ParsedFiles = {
        markdownFile: markdownVirtualFile,
        assetFiles,
        totalSize: 100,
        isTotalSizeExceeded: false,
        hasInvalidFiles: false,
      };

      const parseResult = await parseMarkdown(mdContent);
      const reconciliation = reconcileAssets(parseResult.imageRefs, assetFiles);

      globalThis.fetch = vi
        .fn()
        .mockImplementation(async (url: string, init?: RequestInit) => {
          if (url.includes('/api/upload/sign')) {
            const body = JSON.parse(init?.body as string);
            expect(body.files[0].type).toBe('image/svg+xml');
            expect(body.files[1].type).toBe('text/markdown');

            return {
              ok: true,
              status: 200,
              json: async () => ({
                files: [
                  {
                    fileId: 'svg-uuid',
                    fileName: 'logo.svg',
                    r2Key: 'temp/uploads/svg-uuid/logo.svg',
                    uploadUrl: 'https://r2.example.com/put-svg',
                  },
                  {
                    fileId: 'md-uuid',
                    fileName: 'doc.md',
                    r2Key: 'temp/uploads/md-uuid/doc.md',
                    uploadUrl: 'https://r2.example.com/put-md',
                  },
                ],
              }),
            } as Response;
          }

          if (url.startsWith('https://r2.example.com/put-')) {
            return { ok: true, status: 200 } as Response;
          }

          if (url.includes('/api/documents')) {
            const commitBody = JSON.parse(init?.body as string);
            expect(commitBody.attachments[0].mimeType).toBe('image/svg+xml');

            return {
              ok: true,
              status: 201,
              json: async () => ({
                id: 'svgDocSlug',
                url: '/p/svgDocSlug',
                title: '空MIMEタイプ検証',
                expiresAt: null,
                createdAt: '2026-10-30T00:00:00.000Z',
              }),
            } as Response;
          }

          return { ok: false, status: 404 } as Response;
        });

      const result = await executePublishPipeline({
        parsedFiles,
        reconciliation,
        parseResult,
        markdownContent: mdContent,
        expiration: 'never',
        baseUrl: 'http://localhost:8787',
      });

      expect(result).not.toBeNull();
      expect(result.id).toBe('svgDocSlug');
    });
  });
});
