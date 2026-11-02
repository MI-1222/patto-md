import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runLogin } from '../src/commands/login.ts';
import { runLogout } from '../src/commands/logout.ts';
import { runPublish } from '../src/commands/publish.ts';
import { runWhoami } from '../src/commands/whoami.ts';
import { readConfigFile, writeConfigFile } from '../src/lib/config.ts';

describe('CLI コマンド実行テスト (commands/*.ts)', () => {
  let tempDir: string;
  let tempConfigFile: string;
  let markdownFile: string;

  const validToken = 'pmd_pat_0123456789012345678901234567890123456789012';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'patto-cli-cmd-test-'));
    tempConfigFile = path.join(tempDir, 'config.json');
    markdownFile = path.join(tempDir, 'sample.md');

    process.env.PATTO_CONFIG_PATH = tempConfigFile;
    delete process.env.PATTO_PAT;
    delete process.env.PATTO_TOKEN;
    delete process.env.PATTO_API_KEY;

    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    delete process.env.PATTO_CONFIG_PATH;
    delete process.env.PATTO_PAT;
    delete process.env.PATTO_TOKEN;
    delete process.env.PATTO_API_KEY;
    process.exitCode = undefined;
  });

  describe('login コマンド', () => {
    it('--token オプションで渡された正当なPATを設定ファイルへ保存すること。', async () => {
      // API疎通のモック (/api/auth/me)
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          user: {
            username: 'testuser',
            provider: 'github',
            providerUserId: '1',
            avatarUrl: null,
          },
        }),
      });

      await runLogin({ token: validToken });

      const config = await readConfigFile(tempConfigFile);
      expect(config.token).toBe(validToken);
      expect(process.exitCode).toBeUndefined();
    });

    it('不正な形式のPATが渡された場合にエラー終了すること。', async () => {
      await runLogin({ token: 'invalid_token' });

      expect(process.exitCode).toBe(1);
      const config = await readConfigFile(tempConfigFile);
      expect(config.token).toBeUndefined();
    });

    it('非TTY環境かつ引数未指定の場合にエラー終了すること。', async () => {
      // process.stdin.isTTY を false に偽装
      const originalIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, 'isTTY', {
        value: false,
        configurable: true,
      });

      try {
        await runLogin({});
        expect(process.exitCode).toBe(1);
      } finally {
        Object.defineProperty(process.stdin, 'isTTY', {
          value: originalIsTTY,
          configurable: true,
        });
      }
    });
  });

  describe('logout コマンド', () => {
    it('設定ファイルに保存されていたトークンを消去すること。', async () => {
      await writeConfigFile(
        { token: validToken, apiUrl: 'http://localhost:8787' },
        tempConfigFile,
      );

      await runLogout();

      const config = await readConfigFile(tempConfigFile);
      expect(config.token).toBeUndefined();
      expect(config.apiUrl).toBe('http://localhost:8787');
    });
  });

  describe('whoami コマンド', () => {
    it('未ログイン時に適切な案内を出力すること。', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await runWhoami();

      expect(logSpy).toHaveBeenCalledWith('未ログイン状態です。');
    });

    it('ログイン済みの場合にマスクされたPATと接続状態を表示すること。', async () => {
      await writeConfigFile({ token: validToken }, tempConfigFile);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          user: {
            username: 'testuser',
            provider: 'github',
            providerUserId: '1',
            avatarUrl: null,
          },
          scopes: ['documents:read', 'documents:write'],
          tokenName: 'CLI Dev Token',
        }),
      });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await runWhoami();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('現在のトークン: pmd_pat_...9012'),
      );
      expect(logSpy).toHaveBeenCalledWith('API認証状態: 有効(接続成功)。');
      expect(logSpy).toHaveBeenCalledWith('ユーザー名: testuser');
      expect(logSpy).toHaveBeenCalledWith('認証プロバイダ: github');
      expect(logSpy).toHaveBeenCalledWith('プロバイダユーザーID: 1');
      expect(logSpy).toHaveBeenCalledWith('トークン名: CLI Dev Token');
      expect(logSpy).toHaveBeenCalledWith(
        '認可スコープ: documents:read, documents:write',
      );
    });
  });

  describe('publish コマンド', () => {
    it('トークンが未設定の場合にエラー終了すること。', async () => {
      await fs.writeFile(markdownFile, '# サンプル\n\n本文。');
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await runPublish(markdownFile);

      expect(process.exitCode).toBe(1);
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'パーソナルアクセストークン(PAT)が設定されていません。',
        ),
      );
    });

    it('存在しないファイルパスが指定された場合にエラー終了すること。', async () => {
      await writeConfigFile({ token: validToken }, tempConfigFile);
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await runPublish(path.join(tempDir, 'non_existent.md'));

      expect(process.exitCode).toBe(1);
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining('Markdownファイルの読み込みに失敗しました'),
      );
    });

    it('参照画像が存在しない場合にエラー終了し、--allow-missing 指定時はスキップして公開できること。', async () => {
      await writeConfigFile({ token: validToken }, tempConfigFile);
      await fs.writeFile(
        markdownFile,
        '# タイトル\n\n![欠落画像](./missing.png)',
      );

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // 1. allowMissing なし -> エラー終了
      await runPublish(markdownFile);
      expect(process.exitCode).toBe(1);
      expect(errSpy).toHaveBeenCalled();

      process.exitCode = undefined;

      // 2. allowMissing あり -> 正常終了
      const fetchMock = vi
        .fn()
        .mockImplementation((url: string, init?: RequestInit) => {
          if (url.includes('/api/upload/sign')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                files: [
                  {
                    fileId: 'file-md',
                    r2Key: 'exp-7d/file-md.md',
                    uploadUrl: 'https://r2.example.com/put-md',
                  },
                ],
              }),
            });
          }
          if (init?.method === 'PUT') {
            return Promise.resolve({ ok: true });
          }
          if (url.includes('/api/documents')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                id: 'slug12345678',
                url: '/p/slug12345678',
                title: 'タイトル',
                createdAt: new Date().toISOString(),
              }),
            });
          }
          return Promise.resolve({ ok: false, status: 404 });
        });
      globalThis.fetch = fetchMock;

      await runPublish(markdownFile, { allowMissing: true, copy: false });
      expect(process.exitCode).toBeUndefined();
    });

    it('Markdownおよび画像が揃っている場合に一連のダイレクトアップロードとコミットが成功すること。', async () => {
      await writeConfigFile({ token: validToken }, tempConfigFile);

      const imgPath = path.join(tempDir, 'figure.png');
      await fs.writeFile(imgPath, Buffer.from('fake-image-bytes'));
      await fs.writeFile(
        markdownFile,
        '# タイトル\n\n![図1](./figure.png)\n\n本文テキスト。',
      );

      const fetchCalls: Array<{
        url: string;
        method: string;
        headers?: HeadersInit;
        body?: BodyInit | null;
      }> = [];

      globalThis.fetch = vi
        .fn()
        .mockImplementation((url: string, init?: RequestInit) => {
          fetchCalls.push({
            url,
            method: init?.method || 'GET',
            headers: init?.headers,
            body: init?.body,
          });

          if (url.includes('/api/upload/sign')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                files: [
                  {
                    fileId: 'f-md',
                    r2Key: 'exp-7d/content.md',
                    uploadUrl: 'https://r2.example.com/put-md',
                  },
                  {
                    fileId: 'f-img',
                    r2Key: 'exp-7d/figure.png',
                    uploadUrl: 'https://r2.example.com/put-img',
                  },
                ],
              }),
            });
          }

          if (init?.method === 'PUT') {
            return Promise.resolve({ ok: true });
          }

          if (url.includes('/api/documents')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                id: 'slugabcdef12',
                url: '/p/slugabcdef12',
                title: 'タイトル',
                createdAt: new Date().toISOString(),
              }),
            });
          }

          return Promise.resolve({ ok: false, status: 404 });
        });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await runPublish(markdownFile, {
        expiration: '7days',
        visibility: 'unlisted',
        copy: false,
      });

      expect(process.exitCode).toBeUndefined();

      // 署名要求の確認
      const signCall = fetchCalls.find((c) =>
        c.url.includes('/api/upload/sign'),
      );
      expect(signCall).toBeDefined();
      const signHeaders = signCall?.headers as
        Record<string, string> | undefined;
      expect(signHeaders?.Authorization).toBe(`Bearer ${validToken}`);

      // 画像PUTの確認 (Content-Type のみで Authorization がないこと)
      const imgPutCall = fetchCalls.find(
        (c) => c.url === 'https://r2.example.com/put-img',
      );
      expect(imgPutCall).toBeDefined();
      expect(imgPutCall?.headers).toEqual({ 'Content-Type': 'image/png' });

      // Markdown PUTの確認 (置換後のURLが含まれていること)
      const mdPutCall = fetchCalls.find(
        (c) => c.url === 'https://r2.example.com/put-md',
      );
      expect(mdPutCall).toBeDefined();
      const uploadedMd = Buffer.from(
        (mdPutCall?.body as Buffer) || '',
      ).toString('utf-8');
      expect(uploadedMd).toContain('![図1](/api/assets/exp-7d/figure.png)');

      // コミット要求の確認
      const commitCall = fetchCalls.find((c) =>
        c.url.includes('/api/documents'),
      );
      expect(commitCall).toBeDefined();
      const commitPayload = JSON.parse(String(commitCall?.body || '{}'));
      expect(commitPayload.title).toBe('タイトル');
      expect(commitPayload.contentR2Key).toBe('exp-7d/content.md');
      expect(commitPayload.attachments).toHaveLength(1);
      expect(commitPayload.attachments[0].r2Key).toBe('exp-7d/figure.png');

      // 結果表示の確認
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('URL: http://localhost:4321/p/slugabcdef12'),
      );
    });

    it('同一画像が複数箇所・表記ゆれで参照されている場合に重複排除して1回のみアップロードすること。', async () => {
      await writeConfigFile({ token: validToken }, tempConfigFile);

      const imgPath = path.join(tempDir, 'dup.png');
      await fs.writeFile(imgPath, Buffer.from('fake-dup-bytes'));
      await fs.writeFile(
        markdownFile,
        '# 重複テスト\n\n![参照1](./dup.png)\n\n<img src="dup.png" />\n\n![参照3](./dup.png)',
      );

      const fetchCalls: Array<{
        url: string;
        method: string;
        body?: BodyInit | null;
      }> = [];

      globalThis.fetch = vi
        .fn()
        .mockImplementation((url: string, init?: RequestInit) => {
          fetchCalls.push({
            url,
            method: init?.method || 'GET',
            body: init?.body,
          });

          if (url.includes('/api/upload/sign')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                files: [
                  {
                    fileId: 'f-md',
                    r2Key: 'exp-7d/content.md',
                    uploadUrl: 'https://r2.example.com/put-md',
                  },
                  {
                    fileId: 'f-img-dup',
                    r2Key: 'exp-7d/dup.png',
                    uploadUrl: 'https://r2.example.com/put-dup',
                  },
                ],
              }),
            });
          }

          if (init?.method === 'PUT') {
            return Promise.resolve({ ok: true });
          }

          if (url.includes('/api/documents')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                id: 'slugdup123',
                url: '/p/slugdup123',
                title: '重複テスト',
                createdAt: new Date().toISOString(),
              }),
            });
          }

          return Promise.resolve({ ok: false, status: 404 });
        });

      vi.spyOn(console, 'log').mockImplementation(() => {});

      await runPublish(markdownFile, { copy: false });

      expect(process.exitCode).toBeUndefined();

      // 署名リクエストの確認: Markdown 1件 + 画像 1件 のみ (合計2件)
      const signCall = fetchCalls.find((c) =>
        c.url.includes('/api/upload/sign'),
      );
      expect(signCall).toBeDefined();
      const signBody = JSON.parse(String(signCall?.body || '{}'));
      expect(signBody.files).toHaveLength(2);
      expect(signBody.files[1].name).toBe('dup.png');

      // 画像PUTの回数確認: 1回のみ実行されたこと
      const imgPuts = fetchCalls.filter(
        (c) => c.url === 'https://r2.example.com/put-dup' && c.method === 'PUT',
      );
      expect(imgPuts).toHaveLength(1);

      // 本文置換の確認: Markdown 内の ./dup.png と dup.png の双方が置換されていること
      const mdPutCall = fetchCalls.find(
        (c) => c.url === 'https://r2.example.com/put-md',
      );
      expect(mdPutCall).toBeDefined();
      const uploadedMd = Buffer.from(
        (mdPutCall?.body as Buffer) || '',
      ).toString('utf-8');
      expect(uploadedMd).toContain('![参照1](/api/assets/exp-7d/dup.png)');
      expect(uploadedMd).toContain('<img src="/api/assets/exp-7d/dup.png" />');
      expect(uploadedMd).toContain('![参照3](/api/assets/exp-7d/dup.png)');

      // コミット情報の確認: attachments が1件のみであること
      const commitCall = fetchCalls.find((c) =>
        c.url.includes('/api/documents'),
      );
      expect(commitCall).toBeDefined();
      const commitPayload = JSON.parse(String(commitCall?.body || '{}'));
      expect(commitPayload.attachments).toHaveLength(1);
      expect(commitPayload.attachments[0].r2Key).toBe('exp-7d/dup.png');
    });

    it('--passcode 指定時に visibility が未指定の場合は自動的に protected としてコミットすること。', async () => {
      await writeConfigFile({ token: validToken }, tempConfigFile);
      await fs.writeFile(markdownFile, '# 暗号化\n\nパスコード保護テキスト。');

      let committedPayload: Record<string, unknown> | undefined;
      globalThis.fetch = vi
        .fn()
        .mockImplementation((url: string, init?: RequestInit) => {
          if (url.includes('/api/upload/sign')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                files: [
                  {
                    fileId: 'f-md',
                    r2Key: 'exp-7d/content.md',
                    uploadUrl: 'https://r2.example.com/put-md',
                  },
                ],
              }),
            });
          }
          if (init?.method === 'PUT') {
            return Promise.resolve({ ok: true });
          }
          if (url.includes('/api/documents')) {
            committedPayload = JSON.parse(String(init?.body || '{}'));
            return Promise.resolve({
              ok: true,
              json: async () => ({
                id: 'slugpass1234',
                url: '/p/slugpass1234',
                title: '暗号化',
                createdAt: new Date().toISOString(),
              }),
            });
          }
          return Promise.resolve({ ok: false, status: 404 });
        });

      await runPublish(markdownFile, {
        passcode: 'secret123',
        copy: false,
      });

      expect(process.exitCode).toBeUndefined();
      expect(committedPayload).toBeDefined();
      expect(committedPayload?.visibility).toBe('protected');
      expect(committedPayload?.passcode).toBe('secret123');
    });

    it('--passcode と --visibility public が矛盾して指定された場合にエラー終了すること。', async () => {
      await writeConfigFile({ token: validToken }, tempConfigFile);
      await fs.writeFile(markdownFile, '# 矛盾\n\nテキスト。');

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await runPublish(markdownFile, {
        passcode: 'secret123',
        visibility: 'public',
      });

      expect(process.exitCode).toBe(1);
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "--passcode 指定時は公開範囲(--visibility)を 'protected' に設定する必要があります",
        ),
      );
    });

    it('--passcode の文字数が不足している場合や超過している場合にエラー終了すること。', async () => {
      await writeConfigFile({ token: validToken }, tempConfigFile);
      await fs.writeFile(markdownFile, '# 不足\n\nテキスト。');

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // 1. 3文字 (不足)
      await runPublish(markdownFile, {
        passcode: '123',
      });

      expect(process.exitCode).toBe(1);
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'パスコードは4文字以上32文字以下で指定してください。',
        ),
      );

      process.exitCode = undefined;

      // 2. 33文字 (超過)
      const overPasscode = 'p'.repeat(33);
      await runPublish(markdownFile, {
        passcode: overPasscode,
      });

      expect(process.exitCode).toBe(1);
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'パスコードは4文字以上32文字以下で指定してください。',
        ),
      );

      process.exitCode = undefined;

      // 3. 空文字
      await runPublish(markdownFile, {
        passcode: '   ',
      });

      expect(process.exitCode).toBe(1);
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'パスコードは4文字以上32文字以下で指定してください。',
        ),
      );
    });

    it('--visibility protected 指定時に --passcode が未指定の場合にエラー終了すること。', async () => {
      await writeConfigFile({ token: validToken }, tempConfigFile);
      await fs.writeFile(markdownFile, '# 未指定\n\nテキスト。');

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await runPublish(markdownFile, {
        visibility: 'protected',
      });

      expect(process.exitCode).toBe(1);
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "公開範囲(--visibility)に 'protected' を指定する場合は、--passcode で暗証番号",
        ),
      );
    });
    it('--title オプションが100文字を超えている場合にエラー終了すること。', async () => {
      await writeConfigFile({ token: validToken }, tempConfigFile);
      await fs.writeFile(markdownFile, '# 見出し\n\n本文。');

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const over100Title = 'a'.repeat(101);
      await runPublish(markdownFile, {
        title: over100Title,
      });

      expect(process.exitCode).toBe(1);
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining('タイトルは100文字以内で指定してください。'),
      );
    });

    it('本文見出しが100文字を超えている場合に警告を出力して安全に100文字に切り詰めてコミットすること。', async () => {
      await writeConfigFile({ token: validToken }, tempConfigFile);

      const over100Heading = 'あ'.repeat(120);
      await fs.writeFile(markdownFile, `# ${over100Heading}\n\n本文。`);

      let committedPayload: Record<string, unknown> | undefined;
      globalThis.fetch = vi
        .fn()
        .mockImplementation((url: string, init?: RequestInit) => {
          if (url.includes('/api/upload/sign')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                files: [
                  {
                    fileId: 'f-md',
                    r2Key: 'exp-7d/content.md',
                    uploadUrl: 'https://r2.example.com/put-md',
                  },
                ],
              }),
            });
          }
          if (init?.method === 'PUT') {
            return Promise.resolve({ ok: true });
          }
          if (url.includes('/api/documents')) {
            committedPayload = JSON.parse(String(init?.body || '{}'));
            return Promise.resolve({
              ok: true,
              json: async () => ({
                id: 'slugtrunc123',
                url: '/p/slugtrunc123',
                title: String(committedPayload?.title || ''),
                createdAt: new Date().toISOString(),
              }),
            });
          }
          return Promise.resolve({ ok: false, status: 404 });
        });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await runPublish(markdownFile, { copy: false });

      expect(process.exitCode).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '警告: 本文見出しから抽出したタイトルが100文字を超えているため切り詰めます。',
        ),
      );
      expect(committedPayload?.title).toBe('あ'.repeat(100));
    });
  });
});
