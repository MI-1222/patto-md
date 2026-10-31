import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeUpdatePipeline, resolveUpdateExpiration } from '../update';
import { updateDocument } from '../client';
import type {
  UploadSignResponse,
  DocumentUpdateResponse,
} from '@patto-md/shared';

describe('ドキュメント更新パイプラインの統合テスト', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('既存アセットを維持しつつ、新規画像と更新後Markdownがアップロードされて更新コミットが完了すること', async () => {
    const documentId = 'test-slug-123';
    const token = 'patto_mod_0123456789abcdef0123456789abcdef';
    const updatedTitle = '更新後タイトル';
    const updatedMarkdown = `
# 更新後タイトル
既存画像:
![既存](/api/assets/existing/old.png)
新規追加画像:
![新規](new-diagram.png)
`;

    const existingAttachments = [
      {
        id: 'att-old-1',
        fileName: 'old.png',
        fileSize: 1024,
        mimeType: 'image/png',
        r2Key: 'existing/old.png',
      },
    ];

    const newFiles = [
      new File(['new-binary'], 'new-diagram.png', { type: 'image/png' }),
    ];

    const putCalls: { url: string; headers: unknown; body: unknown }[] = [];
    let updateRequestBody: unknown = null;
    let authHeader: string | null = null;

    globalThis.fetch = vi
      .fn()
      .mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes('/api/upload/sign')) {
          const body = JSON.parse(init?.body as string) as {
            files: { name: string; size: number; type: string }[];
          };

          const response: UploadSignResponse = {
            files: body.files.map((f, i) => ({
              fileId: `new-uuid-${i + 1}`,
              fileName: f.name,
              r2Key: `temp/uploads/new-uuid-${i + 1}/${f.name}`,
              uploadUrl: `https://r2.example.com/upload/new-uuid-${i + 1}/${f.name}`,
            })),
          };

          return new Response(JSON.stringify(response), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (url.includes('https://r2.example.com/upload/')) {
          putCalls.push({
            url,
            headers: init?.headers,
            body: init?.body,
          });
          return new Response(null, { status: 200 });
        }

        if (url.includes(`/api/documents/${documentId}`)) {
          authHeader = (init?.headers as Record<string, string>)[
            'Authorization'
          ];
          updateRequestBody = JSON.parse(init?.body as string);

          const response: DocumentUpdateResponse = {
            id: documentId,
            url: `https://example.com/p/${documentId}`,
            title: updatedTitle,
            visibility: 'public',
            description: '更新後タイトル',
            expiresAt: '2026-11-01T00:00:00.000Z',
            createdAt: '2026-10-31T00:00:00.000Z',
            updatedAt: '2026-10-31T10:00:00.000Z',
          };

          return new Response(JSON.stringify(response), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response('Not Found', { status: 404 });
      });

    const result = await executeUpdatePipeline({
      documentId,
      token,
      title: updatedTitle,
      markdownContent: updatedMarkdown,
      existingAttachments,
      newFiles,
      baseUrl: 'https://api.example.com',
    });

    expect(result.id).toBe(documentId);
    expect(result.title).toBe(updatedTitle);

    // 新規画像1件 + Markdown本文1件 = 合計2件のDirect PUTが実行されたこと。
    expect(putCalls.length).toBe(2);

    // `Authorization: Bearer` ヘッダーが正しく付与されていること。
    expect(authHeader).toBe(`Bearer ${token}`);

    // 更新リクエストボディの検証。
    const req = updateRequestBody as {
      title: string;
      contentR2Key: string;
      attachments: { id: string; fileName: string; r2Key: string }[];
    };
    expect(req.title).toBe(updatedTitle);
    expect(req.contentR2Key).toContain('temp/uploads/');

    // 既存添付ファイルと新規画像が統合されていること(合計2件)。
    expect(req.attachments.length).toBe(2);
    expect(req.attachments[0].fileName).toBe('old.png');
    expect(req.attachments[1].fileName).toBe('new-diagram.png');
  });

  it('新規画像なしで本文のみ更新する場合も正常に完了すること', async () => {
    const documentId = 'test-slug-456';
    const token = 'patto_edit_0123456789abcdef0123456789abcdef';
    const updatedTitle = '本文のみ修正';
    const updatedMarkdown = '# 本文のみ修正\nテキストを更新しました。';

    globalThis.fetch = vi
      .fn()
      .mockImplementation(async (url: string, _init?: RequestInit) => {
        if (url.includes('/api/upload/sign')) {
          const response: UploadSignResponse = {
            files: [
              {
                fileId: 'sign-md-1',
                fileName: 'content.md',
                r2Key: 'temp/uploads/sign-md-1/content.md',
                uploadUrl: 'https://r2.example.com/upload/sign-md-1/content.md',
              },
            ],
          };
          return new Response(JSON.stringify(response), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (url.includes('https://r2.example.com/upload/')) {
          return new Response(null, { status: 200 });
        }

        if (url.includes(`/api/documents/${documentId}`)) {
          const response: DocumentUpdateResponse = {
            id: documentId,
            url: `https://example.com/p/${documentId}`,
            title: updatedTitle,
            visibility: 'public',
            description: '本文のみ修正',
            expiresAt: null,
            createdAt: '2026-10-31T00:00:00.000Z',
            updatedAt: '2026-10-31T10:00:00.000Z',
          };
          return new Response(JSON.stringify(response), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response('Not Found', { status: 404 });
      });

    const result = await executeUpdatePipeline({
      documentId,
      token,
      title: updatedTitle,
      markdownContent: updatedMarkdown,
      existingAttachments: [],
      newFiles: [],
      baseUrl: 'https://api.example.com',
    });

    expect(result.id).toBe(documentId);
    expect(result.title).toBe(updatedTitle);
  });

  it('タイトルが空の場合はバリデーションエラーをスローすること', async () => {
    await expect(
      executeUpdatePipeline({
        documentId: 'slug-test',
        token: 'token',
        title: '   ',
        markdownContent: '# テスト本文',
        existingAttachments: [],
      }),
    ).rejects.toThrow('タイトルが入力されていません。');
  });

  it('本文が空の場合はバリデーションエラーをスローすること', async () => {
    await expect(
      executeUpdatePipeline({
        documentId: 'slug-test',
        token: 'token',
        title: 'タイトル',
        markdownContent: '   ',
        existingAttachments: [],
      }),
    ).rejects.toThrow('Markdown本文が入力されていません。');
  });

  it('未解決の新規画像がありallowIncompletePublishがfalseの場合はエラーをスローすること', async () => {
    const mdContent = '# テスト\n![存在しない画像](missing.png)';

    await expect(
      executeUpdatePipeline({
        documentId: 'slug-test',
        token: 'token',
        title: 'タイトル',
        markdownContent: mdContent,
        existingAttachments: [],
        newFiles: [],
        allowIncompletePublish: false,
      }),
    ).rejects.toThrow('未解決の新規追加画像が存在します。');
  });

  it('添付ファイルの合計サイズが30MBを超過している場合はバリデーションエラーをスローすること', async () => {
    await expect(
      executeUpdatePipeline({
        documentId: 'slug-test',
        token: 'token',
        title: 'タイトル',
        markdownContent: '# テスト本文',
        existingAttachments: [
          {
            id: 'att-1',
            fileName: 'large.png',
            fileSize: 31 * 1024 * 1024,
            mimeType: 'image/png',
            r2Key: 'temp/large.png',
          },
        ],
      }),
    ).rejects.toThrow('添付ファイルの合計サイズが上限(30MB)を超過しています。');
  });
});

describe('updateDocument クライアントAPI関数の検証', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('APIエラー発生時にステータスコードとメッセージを保持したApiErrorをスローすること', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: '更新権限がありません。' },
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    await expect(
      updateDocument(
        'test-id',
        {
          title: 'テスト',
          contentR2Key: 'test.md',
          attachments: [],
        },
        'invalid-token',
        'https://api.example.com',
      ),
    ).rejects.toThrow('更新権限がありません。');
  });
});

describe('resolveUpdateExpiration 有効期限判定関数の検証', () => {
  it('明示的な指定がある場合は最優先でその値を返すこと', () => {
    const result = resolveUpdateExpiration({
      explicitExpiration: '30days',
      existingAttachments: [
        {
          id: '1',
          fileName: 'img.png',
          fileSize: 100,
          mimeType: 'image/png',
          r2Key: 'exp-1d/uploads/uuid/img.png',
        },
      ],
      expiresAt: null,
    });
    expect(result).toBe('30days');
  });

  it('既存添付ファイルがある場合はそのキーのプレフィックスから判定すること', () => {
    expect(
      resolveUpdateExpiration({
        existingAttachments: [
          {
            id: '1',
            fileName: 'img.png',
            fileSize: 100,
            mimeType: 'image/png',
            r2Key: 'exp-1d/uploads/uuid/img.png',
          },
        ],
      }),
    ).toBe('1day');

    expect(
      resolveUpdateExpiration({
        existingAttachments: [
          {
            id: '2',
            fileName: 'img.png',
            fileSize: 100,
            mimeType: 'image/png',
            r2Key: 'exp-7d/uploads/uuid/img.png',
          },
        ],
      }),
    ).toBe('7days');

    expect(
      resolveUpdateExpiration({
        existingAttachments: [
          {
            id: '3',
            fileName: 'img.png',
            fileSize: 100,
            mimeType: 'image/png',
            r2Key: 'exp-30d/uploads/uuid/img.png',
          },
        ],
      }),
    ).toBe('30days');

    expect(
      resolveUpdateExpiration({
        existingAttachments: [
          {
            id: '4',
            fileName: 'img.png',
            fileSize: 100,
            mimeType: 'image/png',
            r2Key: 'permanent/uploads/uuid/img.png',
          },
        ],
      }),
    ).toBe('never');
  });

  it('既存添付ファイルがなく expiresAt が null の場合は never を返すこと', () => {
    const result = resolveUpdateExpiration({
      existingAttachments: [],
      expiresAt: null,
      createdAt: '2026-10-31T00:00:00.000Z',
    });
    expect(result).toBe('never');
  });

  it('既存添付ファイルがなく expiresAt と createdAt の差分からプリセットを判定すること', () => {
    // 1日 (24時間)
    expect(
      resolveUpdateExpiration({
        existingAttachments: [],
        createdAt: '2026-10-31T00:00:00.000Z',
        expiresAt: '2026-11-01T00:00:00.000Z',
      }),
    ).toBe('1day');

    // 7日
    expect(
      resolveUpdateExpiration({
        existingAttachments: [],
        createdAt: '2026-10-31T00:00:00.000Z',
        expiresAt: '2026-11-07T00:00:00.000Z',
      }),
    ).toBe('7days');

    // 30日
    expect(
      resolveUpdateExpiration({
        existingAttachments: [],
        createdAt: '2026-10-31T00:00:00.000Z',
        expiresAt: '2026-11-30T00:00:00.000Z',
      }),
    ).toBe('30days');
  });

  it('有効期限の判定材料がない場合は undefined を返すこと', () => {
    expect(resolveUpdateExpiration({})).toBeUndefined();
    expect(
      resolveUpdateExpiration({
        existingAttachments: [
          {
            id: 'legacy',
            fileName: 'img.png',
            fileSize: 100,
            mimeType: 'image/png',
            r2Key: 'temp/uploads/uuid/img.png',
          },
        ],
      }),
    ).toBeUndefined();
  });
});
