// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MyPageContainer } from '../MyPageContainer';
import type { AuthUser, DocumentListResponse } from '@patto-md/shared';

// React 19 の act 環境フラグを有効化。
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('MyPageContainer 画面コンテナの動作検証', () => {
  let container: HTMLDivElement;
  let root: Root;

  const mockInitialData: DocumentListResponse = {
    items: [],
    total: 0,
    page: 1,
    limit: 12,
    totalPages: 0,
  };

  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.restoreAllMocks();

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ user: null }),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ items: [], tokens: [] }),
      } as unknown as Response);
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    globalThis.fetch = originalFetch;
  });

  it('デフォルトで「マイドキュメント」タブがアクティブになり、ドキュメント管理が表示される。', async () => {
    window.history.replaceState(null, '', '/my');

    await act(async () => {
      root.render(
        <MyPageContainer
          initialData={mockInitialData}
          apiBaseUrl="http://localhost:8787"
          initialUser={null}
        />,
      );
    });

    expect(container.textContent).toContain('マイページ');
    expect(container.textContent).toContain('マイドキュメント');
    expect(container.textContent).toContain('APIトークン (PAT)');

    // マイページ用ドキュメント管理ヘッダーの存在を確認。
    expect(container.textContent).toContain('作成・投稿したドキュメント');
  });

  it('「APIトークン (PAT)」タブをクリックするとトークン管理UIに切り替わり、URLパラメータが同期される。', async () => {
    window.history.replaceState(null, '', '/my');

    await act(async () => {
      root.render(
        <MyPageContainer
          initialData={mockInitialData}
          apiBaseUrl="http://localhost:8787"
          initialUser={null}
        />,
      );
    });

    const tokenTabButton = Array.from(
      container.querySelectorAll('button'),
    ).find((b) => b.textContent?.includes('APIトークン (PAT)'));
    expect(tokenTabButton).toBeDefined();

    await act(async () => {
      tokenTabButton?.click();
    });

    // PAT管理領域(未認証時の案内)の表示を確認。
    expect(container.textContent).toContain(
      'パーソナルアクセストークン(PAT)の発行・管理',
    );
    expect(window.location.search).toContain('tab=tokens');

    // 「マイドキュメント」タブをクリックして戻る。
    const docsTabButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('マイドキュメント'),
    );
    expect(docsTabButton).toBeDefined();

    await act(async () => {
      docsTabButton?.click();
    });

    expect(container.textContent).toContain('作成・投稿したドキュメント');
    expect(window.location.search).not.toContain('tab=tokens');
  });

  it('URLに `?tab=tokens` が含まれている場合、初期マウント時にPAT管理タブがアクティブになる。', async () => {
    window.history.replaceState(null, '', '/my?tab=tokens');

    await act(async () => {
      root.render(
        <MyPageContainer
          initialData={mockInitialData}
          apiBaseUrl="http://localhost:8787"
          initialUser={null}
        />,
      );
    });

    expect(container.textContent).toContain(
      'パーソナルアクセストークン(PAT)の発行・管理',
    );
  });

  it('ログイン済みユーザーの場合にPAT設定一覧ヘッダーが表示される。', async () => {
    window.history.replaceState(null, '', '/my?tab=tokens');

    const mockUser: AuthUser = {
      provider: 'github',
      providerUserId: '999',
      username: 'Logged-in Dev',
      avatarUrl: 'https://example.com/avatar.png',
    };

    await act(async () => {
      root.render(
        <MyPageContainer
          initialData={mockInitialData}
          apiBaseUrl="http://localhost:8787"
          initialUser={mockUser}
        />,
      );
    });

    expect(container.textContent).toContain('APIトークン設定 (PAT)');
  });
});
