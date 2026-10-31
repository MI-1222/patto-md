import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useTransition,
} from 'react';
import type {
  AuthUser,
  DocumentListItem,
  DocumentListResponse,
} from '@patto-md/shared';
import {
  claimDocument,
  fetchCurrentUser,
  fetchDocuments,
  getApiBaseUrl,
} from '../../lib/api';
import { getMyDocumentIds } from '../../lib/storage/myDocuments';
import { getDocumentTokens } from '../../lib/storage/tokens';
import { SearchIcon, UserCheckIcon } from '../svg/ActionIcons';
import { DocumentCard } from './DocumentCard';

/** タブ種別の定義。 */
export type DocumentTab = 'all' | 'mine';

/** ドキュメント一覧コンテナの `props` 定義。 */
export interface DocumentListContainerProps {
  /** サーバーサイドレンダリング時に取得した全体一覧の初期データ。 */
  initialData: DocumentListResponse;
  /** APIベースURL。 */
  apiBaseUrl?: string;
}

/**
 * URLクエリパラメータとタブ・ページ番号の状態を同期する。
 *
 * @param tab - 選択されたタブ種別。
 * @param page - 現在のページ番号。
 */
function syncUrlState(tab: DocumentTab, page: number): void {
  if (typeof window === 'undefined') return;

  const params = new URLSearchParams(window.location.search);
  if (tab === 'mine') {
    params.set('tab', 'mine');
  } else {
    params.delete('tab');
  }

  if (page > 1) {
    params.set('page', String(page));
  } else {
    params.delete('page');
  }

  const queryString = params.toString();
  const newUrl = `${window.location.pathname}${queryString ? `?${queryString}` : ''}`;
  window.history.pushState(null, '', newUrl);
}

/**
 * ドキュメント一覧画面のメインインタラクティブコンポーネント。
 *
 * 全体公開ドキュメントと自ブラウザ作成ドキュメントのタブ切り替え、
 * URLクエリパラメータ同期、クライアント側クイックフィルター、
 * ページネーションおよびデータフェッチ状態を管理する。
 */
export const DocumentListContainer: React.FC<DocumentListContainerProps> = ({
  initialData,
  apiBaseUrl,
}) => {
  const [activeTab, setActiveTab] = useState<DocumentTab>('all');
  const [currentPage, setCurrentPage] = useState<number>(initialData.page);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [myDocumentIds, setMyDocumentIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [allData, setAllData] = useState<DocumentListResponse>(initialData);
  const [mineData, setMineData] = useState<DocumentListResponse | null>(null);
  const [unclaimedDocs, setUnclaimedDocs] = useState<DocumentListItem[]>([]);
  const [isClaimingAll, setIsClaimingAll] = useState<boolean>(false);
  const [claimNotice, setClaimNotice] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const [, startTransition] = useTransition();

  /**
   * ドキュメント一覧データを API から取得する。
   *
   * 選択中のタブ種別に応じて以下の通りデータを取得・反映する。
   * - `all`: 全体公開ドキュメントをページ単位で取得する。
   * - `mine` (ログイン時): アカウント所有ドキュメントをページ単位で取得し、同時にローカルストレージ内の未統合ドキュメントを検出する。
   * - `mine` (未ログイン時): ローカルストレージに保持されたドキュメント ID 群から一覧を取得する。
   *
   * @param tab - 表示対象のタブ種別。
   * @param page - 取得対象のページ番号。
   * @param targetIds - 絞り込み対象のドキュメント ID 群。
   * @param user - ログイン中ユーザー情報(任意)。
   */
  const loadDocuments = useCallback(
    async (
      tab: DocumentTab,
      page: number,
      targetIds: string[],
      user?: AuthUser | null,
    ) => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        if (tab === 'mine') {
          const activeUser =
            user !== undefined ? user : await fetchCurrentUser();
          if (user === undefined) {
            setCurrentUser(activeUser);
          }

          if (activeUser) {
            const mineResult = await fetchDocuments({
              page,
              limit: 12,
              mine: true,
              baseUrl: apiBaseUrl,
            });
            setMineData(mineResult.data);

            if (targetIds.length > 0) {
              try {
                const allMineResult = await fetchDocuments({
                  page: 1,
                  limit: 100,
                  mine: true,
                  baseUrl: apiBaseUrl,
                });
                const ownedIdSet = new Set(
                  allMineResult.data.items.map((item) => item.id),
                );
                const unclaimedIds = targetIds.filter(
                  (id) => !ownedIdSet.has(id),
                );

                if (unclaimedIds.length > 0) {
                  const localResult = await fetchDocuments({
                    page: 1,
                    limit: 50,
                    ids: unclaimedIds,
                    baseUrl: apiBaseUrl,
                  });
                  setUnclaimedDocs(localResult.data.items);
                } else {
                  setUnclaimedDocs([]);
                }
              } catch {
                setUnclaimedDocs([]);
              }
            } else {
              setUnclaimedDocs([]);
            }
          } else {
            setUnclaimedDocs([]);
            if (targetIds.length === 0) {
              setMineData({
                items: [],
                total: 0,
                page: 1,
                limit: 12,
                totalPages: 0,
              });
              setIsLoading(false);
              return;
            }

            const result = await fetchDocuments({
              page,
              limit: 12,
              ids: targetIds,
              baseUrl: apiBaseUrl,
            });
            setMineData(result.data);
          }
        } else {
          setUnclaimedDocs([]);
          const result = await fetchDocuments({
            page,
            limit: 12,
            baseUrl: apiBaseUrl,
          });
          setAllData(result.data);
        }
      } catch (error) {
        console.error('ドキュメント一覧読み込みエラー:', error);
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'ドキュメント一覧の取得に失敗しました。',
        );
      } finally {
        setIsLoading(false);
      }
    },
    [apiBaseUrl],
  );

  /** ローカルストレージ内の未保存ドキュメントをログイン中のアカウントに一括統合する。 */
  const handleBatchClaim = async () => {
    if (!currentUser || unclaimedDocs.length === 0 || isClaimingAll) {
      return;
    }

    setIsClaimingAll(true);
    setClaimNotice(null);

    let successCount = 0;
    let failCount = 0;

    for (const doc of unclaimedDocs) {
      const tokens = getDocumentTokens(doc.id);
      const editToken = tokens?.editToken;
      if (!editToken) {
        failCount += 1;
        continue;
      }

      try {
        await claimDocument(doc.id, editToken, apiBaseUrl);
        successCount += 1;
      } catch (err) {
        console.error(`ドキュメント ${doc.id} の統合に失敗。`, err);
        failCount += 1;
      }
    }

    setIsClaimingAll(false);

    if (successCount > 0) {
      setClaimNotice({
        type: 'success',
        message: `${successCount}件のドキュメントをアカウントに保存しました。${
          failCount > 0 ? `(${failCount}件は保存に失敗)` : ''
        }`,
      });
      loadDocuments(activeTab, currentPage, myDocumentIds, currentUser);
    } else {
      setClaimNotice({
        type: 'error',
        message: 'ドキュメントのアカウント保存に失敗しました。',
      });
    }
  };

  // 初回マウント時にローカルストレージ、ログイン状態、およびURLパラメータから初期状態を反映
  useEffect(() => {
    fetchCurrentUser().then((user) => {
      setCurrentUser(user);
    });

    const ids = getMyDocumentIds();
    setMyDocumentIds(ids);

    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    const pageParam = parseInt(params.get('page') || '1', 10);
    const targetTab: DocumentTab = tabParam === 'mine' ? 'mine' : 'all';
    const targetPage =
      Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;

    if (targetTab !== 'all' || targetPage !== initialData.page) {
      setActiveTab(targetTab);
      setCurrentPage(targetPage);
      loadDocuments(targetTab, targetPage, ids);
    }
  }, [initialData.page, loadDocuments]);

  // ブラウザの戻る・進む(popstate)操作に連動
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab');
      const pageParam = parseInt(params.get('page') || '1', 10);
      const targetTab: DocumentTab = tabParam === 'mine' ? 'mine' : 'all';
      const targetPage =
        Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;

      setActiveTab(targetTab);
      setCurrentPage(targetPage);
      const ids = getMyDocumentIds();
      loadDocuments(targetTab, targetPage, ids);
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [loadDocuments]);

  /**
   * タブ切り替え時のハンドラー関数。
   *
   * @param tab - 切り替え先のタブ種別。
   */
  const handleTabChange = useCallback(
    (tab: DocumentTab) => {
      if (tab === activeTab) return;
      setActiveTab(tab);
      setCurrentPage(1);
      syncUrlState(tab, 1);

      if (tab === 'mine') {
        if (mineData === null) {
          startTransition(() => {
            loadDocuments('mine', 1, myDocumentIds);
          });
        }
      } else {
        if (allData.page !== 1) {
          startTransition(() => {
            loadDocuments('all', 1, myDocumentIds);
          });
        }
      }
    },
    [activeTab, allData.page, mineData, myDocumentIds, loadDocuments],
  );

  /**
   * ページネーション変更時のハンドラー関数。
   *
   * @param newPage - 移動先のページ番号。
   */
  const handlePageChange = useCallback(
    (newPage: number) => {
      if (newPage === currentPage || newPage < 1) return;
      setCurrentPage(newPage);
      syncUrlState(activeTab, newPage);
      window.scrollTo({ top: 0, behavior: 'smooth' });

      startTransition(() => {
        loadDocuments(activeTab, newPage, myDocumentIds);
      });
    },
    [activeTab, currentPage, myDocumentIds, loadDocuments],
  );

  /** 現在選択中のタブに応じたドキュメントレスポンスデータ。 */
  const currentData = activeTab === 'all' ? allData : mineData;
  /** 一覧に表示するドキュメント配列。 */
  const items: DocumentListItem[] = currentData?.items ?? [];
  /** 総ページ数。 */
  const totalPages = currentData?.totalPages ?? 0;
  /** 検索条件に合致する総ドキュメント数。 */
  const totalCount = currentData?.total ?? 0;

  /** クライアント側クイックフィルター適用後のドキュメント一覧。 */
  const filteredItems = useMemo(() => {
    const trimmed = searchQuery.trim().toLowerCase();
    if (!trimmed) return items;
    return items.filter(
      (doc) =>
        doc.title.toLowerCase().includes(trimmed) ||
        (doc.description && doc.description.toLowerCase().includes(trimmed)) ||
        doc.id.toLowerCase().includes(trimmed),
    );
  }, [items, searchQuery]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100 sm:text-3xl">
            公開ドキュメント一覧
          </h1>
        </div>

        <a
          href="/"
          className="inline-flex items-center justify-center self-start rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 focus:ring-2 focus:ring-blue-400 focus:outline-none"
        >
          ＋ 新規ドキュメントを公開
        </a>
      </div>

      <div className="flex flex-col gap-3 border-b border-neutral-800 pb-3 sm:flex-row sm:items-center sm:justify-between sm:pb-0">
        <div className="flex">
          <button
            type="button"
            onClick={() => handleTabChange('all')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'all'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'
            }`}
          >
            <span>すべての公開ドキュメント</span>
            <span className="rounded-full bg-neutral-800 px-2 py-0.5 font-mono text-xs text-neutral-400">
              {allData.total}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('mine')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'mine'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'
            }`}
          >
            <span>自分の投稿</span>
            {mineData !== null ? (
              <span className="rounded-full bg-neutral-800 px-2 py-0.5 font-mono text-xs text-neutral-400">
                {mineData.total}
              </span>
            ) : (
              <span className="h-4 w-5 animate-pulse rounded-full bg-neutral-800" />
            )}
          </button>
        </div>

        <div className="relative flex-1 sm:max-w-xs">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <SearchIcon className="size-3.5 text-neutral-500" />
          </div>
          <input
            type="search"
            placeholder="タイトルで絞り込み..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-neutral-800 bg-neutral-900/60 py-1.5 pr-3 pl-8 text-xs text-neutral-200 placeholder:text-neutral-500 focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>

      {errorMessage && (
        <div className="flex items-center justify-between rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => loadDocuments(activeTab, currentPage, myDocumentIds)}
            className="rounded bg-red-500/20 px-2.5 py-1 text-xs transition-colors hover:bg-red-500/30"
          >
            再試行
          </button>
        </div>
      )}

      {claimNotice && (
        <div
          className={`flex items-center justify-between rounded-xl border p-4 text-xs ${
            claimNotice.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-red-500/30 bg-red-500/10 text-red-300'
          }`}
        >
          <span>{claimNotice.message}</span>
          <button
            type="button"
            onClick={() => setClaimNotice(null)}
            className="text-neutral-400 transition-colors hover:text-neutral-200"
          >
            ✕
          </button>
        </div>
      )}

      {activeTab === 'mine' && currentUser && unclaimedDocs.length > 0 && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-lg bg-blue-500/20 p-2 text-blue-400">
                <UserCheckIcon className="size-5" />
              </div>
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-neutral-100">
                  この端末で作成された未保存のドキュメント（
                  {unclaimedDocs.length}件）
                </h2>
                <p className="text-xs text-neutral-400">
                  このブラウザに保存されている投稿履歴をログイン中のアカウントに統合すると、他端末からも管理できるようになります。
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {unclaimedDocs.slice(0, 5).map((doc) => (
                    <a
                      key={doc.id}
                      href={`/p/${doc.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded bg-neutral-900/60 px-2 py-0.5 text-[11px] text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-white"
                      title={doc.title}
                    >
                      <span className="max-w-30 truncate">{doc.title}</span>
                    </a>
                  ))}
                  {unclaimedDocs.length > 5 && (
                    <span className="self-center text-[11px] text-neutral-500">
                      他 {unclaimedDocs.length - 5} 件
                    </span>
                  )}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleBatchClaim}
              disabled={isClaimingAll}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 focus:ring-2 focus:ring-blue-400 focus:outline-none disabled:opacity-50"
            >
              {isClaimingAll ? (
                <>
                  <span className="size-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>アカウントに統合中...</span>
                </>
              ) : (
                <span>すべてアカウントに保存</span>
              )}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="flex flex-col justify-between rounded-xl border border-neutral-800/80 bg-neutral-900/30 p-5"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="h-5 w-20 animate-pulse rounded bg-neutral-800" />
                  <div className="h-6 w-14 animate-pulse rounded-lg bg-neutral-800/60" />
                </div>
                <div className="h-5 w-3/4 animate-pulse rounded bg-neutral-800" />
                <div className="space-y-1.5 pt-1">
                  <div className="h-3 w-full animate-pulse rounded bg-neutral-800/50" />
                  <div className="h-3 w-2/3 animate-pulse rounded bg-neutral-800/50" />
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-neutral-800/60 pt-3">
                <div className="h-3 w-16 animate-pulse rounded bg-neutral-800/50" />
                <div className="h-3 w-10 animate-pulse rounded bg-neutral-800/50" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-800 bg-neutral-900/20 p-12 text-center">
          <p className="text-sm font-medium text-neutral-300">
            {activeTab === 'mine'
              ? 'このブラウザから公開されたドキュメントはありません。'
              : '現在公開されているドキュメントはありません。'}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            {activeTab === 'mine'
              ? 'トップページからMarkdownをドロップして公開すると、ここに履歴が表示されます。'
              : 'Markdownファイルをドロップして最初のドキュメントを公開できます。'}
          </p>
          {activeTab === 'mine' && (
            <>
              <p className="mt-1 text-xs text-neutral-500">
                {currentUser
                  ? 'アカウントに保存されたドキュメントおよびこのブラウザで作成されたドキュメントが表示されます。'
                  : '※ 投稿履歴はこのブラウザのローカルストレージに保存されます。端末やブラウザを変更すると表示されません。'}
              </p>
              {!currentUser && (
                <div className="mt-4 flex items-center gap-3">
                  <a
                    href={`${getApiBaseUrl()}/api/auth/github?return_to=${encodeURIComponent(
                      typeof window !== 'undefined'
                        ? window.location.pathname + window.location.search
                        : '',
                    )}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800/80 px-3.5 py-2 text-xs font-medium text-neutral-200 transition-colors hover:bg-neutral-700"
                  >
                    <span>GitHubでログイン</span>
                  </a>
                  <a
                    href={`${getApiBaseUrl()}/api/auth/discord?return_to=${encodeURIComponent(
                      typeof window !== 'undefined'
                        ? window.location.pathname + window.location.search
                        : '',
                    )}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#5865F2]/20 px-3.5 py-2 text-xs font-medium text-[#5865F2] transition-colors hover:bg-[#5865F2]/30"
                  >
                    <span>Discordでログイン</span>
                  </a>
                </div>
              )}
            </>
          )}
          <a
            href="/"
            className="mt-4 rounded-lg border border-neutral-700 bg-neutral-800/60 px-4 py-2 text-xs font-medium text-neutral-200 transition-colors hover:bg-neutral-800"
          >
            ドキュメントを公開する
          </a>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-800 bg-neutral-900/20 p-12 text-center">
          <p className="text-sm font-medium text-neutral-300">
            一致するドキュメントが見つかりませんでした。
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            検索キーワード「{searchQuery}」に合致するドキュメントはありません。
          </p>
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="mt-3 text-xs text-blue-400 hover:underline"
          >
            フィルターをクリア
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
          {filteredItems.map((doc) => (
            <DocumentCard
              key={doc.id}
              document={doc}
              isMine={myDocumentIds.includes(doc.id)}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && !isLoading && (
        <div className="flex items-center justify-between border-t border-neutral-800 pt-6">
          <div className="text-xs text-neutral-400">
            全 <span className="font-mono text-neutral-200">{totalCount}</span>{' '}
            件中{' '}
            <span className="font-mono text-neutral-200">
              {(currentPage - 1) * 12 + 1} -{' '}
              {Math.min(currentPage * 12, totalCount)}
            </span>{' '}
            件を表示
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => handlePageChange(currentPage - 1)}
              className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:bg-neutral-800 disabled:opacity-40 disabled:hover:bg-neutral-900/60"
            >
              前へ
            </button>

            <div className="flex items-center gap-1 px-1">
              {Array.from({ length: totalPages }, (_, index) => index + 1)
                .filter((p) => {
                  return (
                    p === 1 ||
                    p === totalPages ||
                    Math.abs(p - currentPage) <= 1
                  );
                })
                .map((p, idx, array) => {
                  const prevPage = array[idx - 1];
                  const hasGap = prevPage && p - prevPage > 1;

                  return (
                    <React.Fragment key={p}>
                      {hasGap && (
                        <span className="px-1 text-xs text-neutral-600">…</span>
                      )}
                      <button
                        type="button"
                        onClick={() => handlePageChange(p)}
                        className={`min-w-8 rounded-lg px-2.5 py-1.5 font-mono text-xs transition-colors ${
                          p === currentPage
                            ? 'bg-blue-600 font-bold text-white'
                            : 'border border-neutral-800 bg-neutral-900/40 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
                        }`}
                      >
                        {p}
                      </button>
                    </React.Fragment>
                  );
                })}
            </div>

            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => handlePageChange(currentPage + 1)}
              className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:bg-neutral-800 disabled:opacity-40 disabled:hover:bg-neutral-900/60"
            >
              次へ
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
