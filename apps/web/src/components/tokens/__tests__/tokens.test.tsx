// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TokenList } from '../TokenList';
import { TokenCreateModal } from '../TokenCreateModal';
import { TokenRevealModal } from '../TokenRevealModal';
import { UserTokensContainer } from '../UserTokensContainer';
import type {
  AuthUser,
  CreatePatResponse,
  UserApiTokenItem,
} from '@patto-md/shared';

// React 19 の act 環境フラグを有効化。
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('パーソナルアクセストークン(PAT)管理UIコンポーネントの動作検証', () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    globalThis.fetch = originalFetch;
  });

  describe('TokenList コンポーネント', () => {
    const mockTokens: UserApiTokenItem[] = [
      {
        id: 'token-1',
        name: 'CLI Publishing Token',
        tokenMasked: 'pmd_pat_...1234',
        scopes: ['documents:read', 'documents:write'],
        expiresAt: new Date(Date.now() + 86400000 * 30).toISOString(),
        lastUsedAt: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
        createdAt: new Date().toISOString(),
      },
      {
        id: 'token-2',
        name: 'Expired Agent Token',
        tokenMasked: 'pmd_pat_...abcd',
        scopes: ['documents:read'],
        expiresAt: new Date(Date.now() - 86400000).toISOString(),
        lastUsedAt: null,
        createdAt: new Date().toISOString(),
      },
    ];

    it('トークンが0件の場合に空状態案内と新規発行ボタンを表示する。', async () => {
      const onCreateClick = vi.fn();
      const onDeleteToken = vi.fn();

      await act(async () => {
        root.render(
          <TokenList
            tokens={[]}
            onDeleteToken={onDeleteToken}
            onCreateClick={onCreateClick}
            isDeletingId={null}
          />,
        );
      });

      expect(container.textContent).toContain(
        'パーソナルアクセストークンは未発行です。',
      );
      const button = container.querySelector('button');
      expect(button).not.toBeNull();
      expect(button?.textContent).toContain('新規トークンを発行');

      await act(async () => {
        button?.click();
      });
      expect(onCreateClick).toHaveBeenCalledTimes(1);
    });

    it('発行済みトークンの一覧情報(名前、マスク、スコープ、期限)が正しく描画される。', async () => {
      const onCreateClick = vi.fn();
      const onDeleteToken = vi.fn();

      await act(async () => {
        root.render(
          <TokenList
            tokens={mockTokens}
            onDeleteToken={onDeleteToken}
            onCreateClick={onCreateClick}
            isDeletingId={null}
          />,
        );
      });

      expect(container.textContent).toContain('CLI Publishing Token');
      expect(container.textContent).toContain('pmd_pat_...1234');
      expect(container.textContent).toContain('read');
      expect(container.textContent).toContain('write');
      expect(container.textContent).toContain('Expired Agent Token');
      expect(container.textContent).toContain('期限切れ');
      expect(container.textContent).toContain('未使用');
    });

    it('有効期限が24時間未満の場合は時間・分単位で残り時間を表示する。', async () => {
      const expiringTokens: UserApiTokenItem[] = [
        {
          id: 'token-hours',
          name: 'Hours Token',
          tokenMasked: 'pmd_pat_...2222',
          scopes: ['documents:read'],
          expiresAt: new Date(
            Date.now() + 1000 * 60 * 60 * 3 + 1000 * 60 * 30,
          ).toISOString(),
          lastUsedAt: null,
          createdAt: new Date().toISOString(),
        },
        {
          id: 'token-minutes',
          name: 'Minutes Token',
          tokenMasked: 'pmd_pat_...3333',
          scopes: ['documents:read'],
          expiresAt: new Date(Date.now() + 1000 * 60 * 25).toISOString(),
          lastUsedAt: null,
          createdAt: new Date().toISOString(),
        },
      ];

      await act(async () => {
        root.render(
          <TokenList
            tokens={expiringTokens}
            onDeleteToken={vi.fn()}
            onCreateClick={vi.fn()}
            isDeletingId={null}
          />,
        );
      });

      expect(container.textContent).toContain('残り3時間');
      expect(container.textContent).toContain('残り25分');
    });

    it('失効ボタンをクリックすると行内にインライン確認UIが展開され、失効できる。', async () => {
      const onCreateClick = vi.fn();
      const onDeleteToken = vi.fn().mockResolvedValue(undefined);

      await act(async () => {
        root.render(
          <TokenList
            tokens={mockTokens}
            onDeleteToken={onDeleteToken}
            onCreateClick={onCreateClick}
            isDeletingId={null}
          />,
        );
      });

      // 失効ボタンをクリック。
      const revokeButtons = container.querySelectorAll<HTMLButtonElement>(
        'button[title="トークンを失効"]',
      );
      expect(revokeButtons.length).toBeGreaterThan(0);

      await act(async () => {
        revokeButtons[0].click();
      });

      // インライン確認メッセージが表示されることを確認。
      expect(container.textContent).toContain('失効させますか');
      expect(container.textContent).toContain('キャンセル');
      expect(container.textContent).toContain('失効する');

      // 確定ボタンをクリック。
      const confirmButton = Array.from(
        container.querySelectorAll('button'),
      ).find((b) => b.textContent?.includes('失効する'));
      expect(confirmButton).toBeDefined();

      await act(async () => {
        confirmButton?.click();
      });

      expect(onDeleteToken).toHaveBeenCalledWith('token-1');
    });
  });

  describe('TokenCreateModal コンポーネント', () => {
    it('isOpen が false の場合は何も描画しない。', async () => {
      await act(async () => {
        root.render(
          <TokenCreateModal
            isOpen={false}
            onClose={vi.fn()}
            onCreateToken={vi.fn()}
          />,
        );
      });

      expect(container.innerHTML).toBe('');
    });

    it('トークン名入力とスコープバリデーションが機能し、発行要求を送信できる。', async () => {
      const onClose = vi.fn();
      const onCreateToken = vi.fn().mockResolvedValue(undefined);

      await act(async () => {
        root.render(
          <TokenCreateModal
            isOpen={true}
            onClose={onClose}
            onCreateToken={onCreateToken}
          />,
        );
      });

      expect(container.textContent).toContain(
        '新規パーソナルアクセストークン発行',
      );

      const submitButton = Array.from(
        container.querySelectorAll('button'),
      ).find((b) => b.textContent?.includes('トークンを発行する'));
      expect(submitButton).toBeDefined();
      // トークン名未入力のため初期は disabled 状態。
      expect(submitButton?.disabled).toBe(true);

      // トークン名を入力。
      const input = container.querySelector<HTMLInputElement>('#token-name');
      expect(input).not.toBeNull();

      await act(async () => {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value',
        )?.set;
        nativeSetter?.call(input, 'My Custom PAT');
        input!.dispatchEvent(new Event('input', { bubbles: true }));
        input!.dispatchEvent(new Event('change', { bubbles: true }));
      });

      // 名前が入力されたため disabled を解除。
      expect(submitButton?.disabled).toBe(false);

      // フォーム送信。
      const form = container.querySelector('form');
      await act(async () => {
        form?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
      });

      expect(onCreateToken).toHaveBeenCalledWith({
        name: 'My Custom PAT',
        scopes: ['documents:read', 'documents:write'],
        expiration: '30days',
      });
    });

    it('キャンセル操作または非表示時にフォーム入力状態が初期値にリセットされる。', async () => {
      const onClose = vi.fn();

      await act(async () => {
        root.render(
          <TokenCreateModal
            isOpen={true}
            onClose={onClose}
            onCreateToken={vi.fn()}
          />,
        );
      });

      const input = container.querySelector<HTMLInputElement>('#token-name');
      expect(input).not.toBeNull();

      // トークン名を入力。
      await act(async () => {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value',
        )?.set;
        nativeSetter?.call(input, 'Draft PAT Name');
        input!.dispatchEvent(new Event('input', { bubbles: true }));
        input!.dispatchEvent(new Event('change', { bubbles: true }));
      });

      expect(input?.value).toBe('Draft PAT Name');

      // キャンセルボタンをクリック。
      const cancelButton = Array.from(
        container.querySelectorAll('button'),
      ).find((b) => b.textContent?.includes('キャンセル'));
      expect(cancelButton).toBeDefined();

      await act(async () => {
        cancelButton?.click();
      });

      expect(onClose).toHaveBeenCalledTimes(1);

      // モーダルが再度開かれた際に入力値が空にリセットされていることを確認。
      await act(async () => {
        root.render(
          <TokenCreateModal
            isOpen={true}
            onClose={onClose}
            onCreateToken={vi.fn()}
          />,
        );
      });

      const newInput = container.querySelector<HTMLInputElement>('#token-name');
      expect(newInput?.value).toBe('');
    });
  });

  describe('TokenRevealModal コンポーネント', () => {
    const mockCreatedToken: CreatePatResponse = {
      id: 'uuid-1',
      name: 'Created Token',
      token: 'pmd_pat_sample1234567890abcdef1234567890abcdef123',
      scopes: ['documents:read', 'documents:write'],
      expiresAt: '2026-12-01T00:00:00.000Z',
      createdAt: '2026-11-01T00:00:00.000Z',
    };

    it('平文トークンと再取得不可の警告が表示され、明示的ボタンでのみ閉じられる。', async () => {
      const onClose = vi.fn();

      // クリップボード API のモック設定。
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: writeTextMock,
        },
        configurable: true,
      });

      await act(async () => {
        root.render(
          <TokenRevealModal token={mockCreatedToken} onClose={onClose} />,
        );
      });

      expect(container.textContent).toContain(
        'このトークンは二度と表示されません。',
      );
      expect(container.textContent).toContain('Created Token');

      const input = container.querySelector<HTMLInputElement>(
        '#revealed-token-input',
      );
      expect(input?.value).toBe(mockCreatedToken.token);

      // コピーボタンをクリック。
      const copyButton = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.includes('コピー'),
      );
      expect(copyButton).toBeDefined();

      await act(async () => {
        copyButton?.click();
      });
      expect(writeTextMock).toHaveBeenCalledWith(mockCreatedToken.token);

      // 完了ボタンをクリック。
      const closeButton = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.includes('トークンを保存しました(閉じる)'),
      );
      expect(closeButton).toBeDefined();

      await act(async () => {
        closeButton?.click();
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('クリップボードコピー失敗時に手動コピーを促すエラー案内が表示される。', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: vi.fn().mockRejectedValue(new Error('Permission denied')),
        },
        configurable: true,
      });

      await act(async () => {
        root.render(
          <TokenRevealModal token={mockCreatedToken} onClose={vi.fn()} />,
        );
      });

      const copyButton = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.includes('コピー'),
      );

      await act(async () => {
        copyButton?.click();
      });

      expect(container.textContent).toContain(
        'コピーに失敗しました。選択された文字列を手動でコピーしてください。',
      );
    });
  });

  describe('UserTokensContainer 統合コンポーネント', () => {
    const mockUser: AuthUser = {
      provider: 'github',
      providerUserId: '12345',
      username: 'Test Developer',
      avatarUrl: 'https://example.com/avatar.png',
    };

    it('未認証時はOAuthログイン誘導カードを表示する。', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ user: null }),
      } as unknown as Response);

      await act(async () => {
        root.render(
          <UserTokensContainer
            apiBaseUrl="http://localhost:8787"
            initialUser={null}
          />,
        );
      });

      expect(container.textContent).toContain(
        'パーソナルアクセストークン(PAT)の発行・管理',
      );
      expect(container.textContent).toContain('GitHubでログイン');
      expect(container.textContent).toContain('Discordでログイン');
    });

    it('認証済みユーザーの場合にトークン一覧を取得・表示する。', async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/auth/me')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ user: mockUser }),
          } as unknown as Response);
        }
        if (url.includes('/api/user/tokens')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              tokens: [
                {
                  id: 'tok-abc',
                  name: 'My Agent Token',
                  tokenMasked: 'pmd_pat_...9999',
                  scopes: ['documents:read'],
                  expiresAt: null,
                  lastUsedAt: null,
                  createdAt: '2026-11-01T00:00:00.000Z',
                },
              ],
            }),
          } as unknown as Response);
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`));
      });

      await act(async () => {
        root.render(
          <UserTokensContainer
            apiBaseUrl="http://localhost:8787"
            initialUser={mockUser}
          />,
        );
      });

      expect(container.textContent).toContain('APIトークン設定 (PAT)');
      expect(container.textContent).toContain('My Agent Token');
      expect(container.textContent).toContain('pmd_pat_...9999');
    });

    it('initialUser が null の場合、マウント時にユーザー解決とトークン取得がそれぞれ1回のみ実行される(二重フェッチ防止)。', async () => {
      let authCallCount = 0;
      let tokensCallCount = 0;

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/auth/me')) {
          authCallCount += 1;
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ user: mockUser }),
          } as unknown as Response);
        }
        if (url.includes('/api/user/tokens')) {
          tokensCallCount += 1;
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              tokens: [
                {
                  id: 'tok-once',
                  name: 'Once Token',
                  tokenMasked: 'pmd_pat_...1111',
                  scopes: ['documents:read'],
                  expiresAt: null,
                  lastUsedAt: null,
                  createdAt: '2026-11-01T00:00:00.000Z',
                },
              ],
            }),
          } as unknown as Response);
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`));
      });

      await act(async () => {
        root.render(
          <UserTokensContainer
            apiBaseUrl="http://localhost:8787"
            initialUser={null}
          />,
        );
      });

      expect(authCallCount).toBe(1);
      expect(tokensCallCount).toBe(1);
      expect(container.textContent).toContain('Once Token');
    });
  });
});
