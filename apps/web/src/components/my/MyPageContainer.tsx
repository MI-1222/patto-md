import React, { useState, useEffect, useCallback } from 'react';
import type { AuthUser, DocumentListResponse } from '@patto-md/shared';
import { DocumentListContainer } from '../documents';
import { UserTokensContainer } from '../tokens';
import { KeyIcon } from '../svg/ActionIcons';

/** マイページのタブ種別。 */
export type MyPageTab = 'docs' | 'tokens';

/** マイページメインコンテナの `props` 定義。 */
export interface MyPageContainerProps {
  /** サーバーサイドレンダリング時に取得した初期ドキュメント一覧データ。 */
  initialData: DocumentListResponse;
  /** APIベースURL。 */
  apiBaseUrl?: string;
  /** SSR側で解決された初期ログインユーザー情報(任意)。 */
  initialUser?: AuthUser | null;
}

/**
 * URLクエリパラメータとマイページのタブ状態を同期する。
 *
 * @param tab - 選択されたタブ種別。
 */
function syncUrlTab(tab: MyPageTab): void {
  if (typeof window === 'undefined') return;

  const params = new URLSearchParams(window.location.search);
  if (tab === 'tokens') {
    params.set('tab', 'tokens');
  } else {
    params.delete('tab');
  }

  const queryString = params.toString();
  const newUrl = `${window.location.pathname}${queryString ? `?${queryString}` : ''}`;
  window.history.pushState(null, '', newUrl);
}

/**
 * マイページ画面の統合インタラクティブコンポーネント。
 *
 * 「ドキュメント管理」と「APIトークン (PAT)」のタブ切り替えおよびURL同期を提供し、
 * アカウント設定・外部連携設定を一元管理する。
 */
export const MyPageContainer: React.FC<MyPageContainerProps> = ({
  initialData,
  apiBaseUrl,
  initialUser,
}) => {
  const [activeTab, setActiveTab] = useState<MyPageTab>('docs');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (tabParam === 'tokens') {
      setActiveTab('tokens');
    } else {
      setActiveTab('docs');
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab');
      setActiveTab(tabParam === 'tokens' ? 'tokens' : 'docs');
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  /**
   * タブ切り替えハンドラー。
   *
   * @param tab - 切り替え先のタブ種別。
   */
  const handleTabChange = useCallback((tab: MyPageTab) => {
    setActiveTab(tab);
    syncUrlTab(tab);
  }, []);

  return (
    <div className="space-y-6">
      <div className="border-b border-neutral-800 pb-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-neutral-100 sm:text-3xl">
              マイページ
            </h1>
            <p className="mt-1 text-xs text-neutral-400">
              公開・作成したMarkdownドキュメントの管理および外部連携用APIトークン(PAT)の設定。
            </p>
          </div>

          <a
            href="/"
            className="inline-flex items-center justify-center self-start rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 focus:ring-2 focus:ring-blue-400 focus:outline-none"
          >
            ＋ 新規ドキュメントを公開
          </a>
        </div>

        <div className="mt-6 flex gap-2">
          <button
            type="button"
            onClick={() => handleTabChange('docs')}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all ${
              activeTab === 'docs'
                ? 'bg-neutral-800 text-white shadow-sm'
                : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'
            }`}
          >
            <span>マイドキュメント</span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('tokens')}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all ${
              activeTab === 'tokens'
                ? 'bg-neutral-800 text-white shadow-sm'
                : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'
            }`}
          >
            <KeyIcon className="size-3.5" />
            <span>APIトークン (PAT)</span>
          </button>
        </div>
      </div>

      <div>
        {activeTab === 'docs' ? (
          <DocumentListContainer
            initialData={initialData}
            apiBaseUrl={apiBaseUrl}
            fixedTab="mine"
            hideHeaderTitle={true}
          />
        ) : (
          <UserTokensContainer
            apiBaseUrl={apiBaseUrl}
            initialUser={initialUser}
          />
        )}
      </div>
    </div>
  );
};
