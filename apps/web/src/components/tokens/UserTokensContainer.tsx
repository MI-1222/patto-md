import React, { useState, useEffect, useCallback } from 'react';
import {
  formatMaskedPat,
  type AuthUser,
  type CreatePatRequest,
  type CreatePatResponse,
  type UserApiTokenItem,
} from '@patto-md/shared';
import {
  createUserToken,
  deleteUserToken,
  fetchCurrentUser,
  fetchUserTokens,
  getApiBaseUrl,
} from '../../lib/api';
import { KeyIcon } from '../svg/ActionIcons';
import { TokenCreateModal } from './TokenCreateModal';
import { TokenList } from './TokenList';
import { TokenRevealModal } from './TokenRevealModal';

/** トークン管理コンテナの `props` 定義。 */
export interface UserTokensContainerProps {
  /** APIベースURL(省略時は `getApiBaseUrl()` を使用)。 */
  apiBaseUrl?: string;
  /** SSR側で解決された認証中ユーザー(任意)。 */
  initialUser?: AuthUser | null;
}

/**
 * パーソナルアクセストークン(PAT)の管理を行うメインReact Islandコンポーネント。
 *
 * 一覧取得、新規発行、ワンタイム平文表示、インライン失効確認を統合管理する。
 */
export const UserTokensContainer: React.FC<UserTokensContainerProps> = ({
  apiBaseUrl = getApiBaseUrl(),
  initialUser,
}) => {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(
    initialUser ?? null,
  );
  const [tokens, setTokens] = useState<UserApiTokenItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSessionExpired, setIsSessionExpired] = useState<boolean>(false);

  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);
  const [createdToken, setCreatedToken] = useState<CreatePatResponse | null>(
    null,
  );
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);

  /**
   * トークン一覧を API から取得する。
   *
   * ユーザー情報が未解決の場合は先に取得する。
   */
  const loadTokens = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setIsSessionExpired(false);

    try {
      let user = currentUser;
      if (!user) {
        user = await fetchCurrentUser(apiBaseUrl);
        setCurrentUser(user);
      }

      if (!user) {
        setIsLoading(false);
        return;
      }

      const res = await fetchUserTokens(apiBaseUrl);
      setTokens(res.tokens);
    } catch (error) {
      console.error('PAT一覧の取得に失敗。', error);
      const isAuthError =
        (error as { status?: number })?.status === 401 ||
        (error instanceof Error && error.message.includes('401'));

      if (isAuthError) {
        setIsSessionExpired(true);
        setErrorMessage(
          'セッションの有効期限が切れました。再度ログインしてください。',
        );
      } else {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'トークン一覧の取得に失敗しました。',
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [apiBaseUrl, currentUser]);

  useEffect(() => {
    loadTokens();
  }, [loadTokens]);

  /**
   * 新規トークン発行ハンドラー。
   *
   * 発行成功時は一覧先頭にマスク済みアイテムを追加し、発行モーダルを閉じて平文表示モーダルを開く。
   */
  const handleCreateToken = async (payload: CreatePatRequest) => {
    try {
      const newPat = await createUserToken(payload, apiBaseUrl);
      const newItem: UserApiTokenItem = {
        id: newPat.id,
        name: newPat.name,
        tokenMasked: formatMaskedPat(newPat.token.slice(-4)),
        scopes: newPat.scopes,
        expiresAt: newPat.expiresAt,
        lastUsedAt: null,
        createdAt: newPat.createdAt,
      };
      setTokens((prev) => [newItem, ...prev]);

      setIsCreateOpen(false);
      setCreatedToken(newPat);
    } catch (error) {
      const isAuthError =
        (error as { status?: number })?.status === 401 ||
        (error instanceof Error && error.message.includes('401'));
      if (isAuthError) {
        setIsSessionExpired(true);
      }
      throw error;
    }
  };

  /** トークン失効ハンドラー。 */
  const handleDeleteToken = async (tokenId: string) => {
    setIsDeletingId(tokenId);
    setErrorMessage(null);

    try {
      await deleteUserToken(tokenId, apiBaseUrl);
      setTokens((prev) => prev.filter((t) => t.id !== tokenId));
    } catch (error) {
      console.error('トークン失効エラー。', error);
      const isAuthError =
        (error as { status?: number })?.status === 401 ||
        (error instanceof Error && error.message.includes('401'));
      if (isAuthError) {
        setIsSessionExpired(true);
        setErrorMessage(
          'セッションの有効期限が切れました。再度ログインしてください。',
        );
      } else {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'トークンの失効に失敗しました。',
        );
      }
    } finally {
      setIsDeletingId(null);
    }
  };

  /** 現在のURL(リターン用)。 */
  const returnToUrl =
    typeof window !== 'undefined'
      ? `${window.location.pathname}${window.location.search}`
      : '/my?tab=tokens';

  if (!isLoading && !currentUser) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-900/40 p-8 text-center sm:p-12">
        <div className="mb-4 rounded-full bg-blue-500/10 p-3 text-blue-400">
          <KeyIcon className="size-8" />
        </div>
        <h3 className="text-base font-bold text-neutral-100 sm:text-lg">
          パーソナルアクセストークン(PAT)の発行・管理
        </h3>
        <p className="mt-2 max-w-md text-xs leading-relaxed text-neutral-400">
          CLIツールやAIエージェント、外部スクリプトと連携するためのPATを発行するには、アカウントへのログインが必要です。
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <a
            href={`${apiBaseUrl}/api/auth/github?return_to=${encodeURIComponent(returnToUrl)}`}
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-100 transition-colors hover:bg-neutral-700 focus:ring-2 focus:ring-neutral-500 focus:outline-none"
          >
            <span>GitHubでログイン</span>
          </a>
          <a
            href={`${apiBaseUrl}/api/auth/discord?return_to=${encodeURIComponent(returnToUrl)}`}
            className="inline-flex items-center gap-2 rounded-lg bg-[#5865F2]/20 px-4 py-2 text-xs font-semibold text-[#5865F2] transition-colors hover:bg-[#5865F2]/30 focus:ring-2 focus:ring-[#5865F2]/50 focus:outline-none"
          >
            <span>Discordでログイン</span>
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-neutral-100 sm:text-xl">
            APIトークン設定 (PAT)
          </h2>
          <p className="mt-1 text-xs text-neutral-400">
            CLIツールや外部クライアントからTurnstileボット認証をバイパスしてアクセスするためのトークンです。
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsCreateOpen(true)}
          disabled={isLoading || isSessionExpired}
          className="inline-flex items-center justify-center self-start rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 focus:ring-2 focus:ring-blue-400 focus:outline-none disabled:opacity-50"
        >
          ＋ 新規トークンを発行
        </button>
      </div>

      {errorMessage && (
        <div className="flex flex-col gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-300 sm:flex-row sm:items-center sm:justify-between">
          <span>{errorMessage}</span>
          <div className="flex items-center gap-2">
            {isSessionExpired ? (
              <a
                href={`${apiBaseUrl}/api/auth/github?return_to=${encodeURIComponent(returnToUrl)}`}
                className="rounded bg-red-500/20 px-3 py-1 font-semibold text-red-200 transition-colors hover:bg-red-500/30"
              >
                再ログイン
              </a>
            ) : (
              <button
                type="button"
                onClick={loadTokens}
                className="rounded bg-red-500/20 px-3 py-1 transition-colors hover:bg-red-500/30"
              >
                再試行
              </button>
            )}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/30 p-8 text-center">
          <div className="inline-block size-6 animate-spin rounded-full border-2 border-neutral-700 border-t-blue-500" />
          <p className="text-xs text-neutral-400">
            トークン一覧を読み込み中...
          </p>
        </div>
      ) : (
        <TokenList
          tokens={tokens}
          onDeleteToken={handleDeleteToken}
          onCreateClick={() => setIsCreateOpen(true)}
          isDeletingId={isDeletingId}
        />
      )}

      <TokenCreateModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreateToken={handleCreateToken}
      />

      {createdToken && (
        <TokenRevealModal
          token={createdToken}
          onClose={() => setCreatedToken(null)}
        />
      )}
    </div>
  );
};
