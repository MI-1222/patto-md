import React, { useState } from 'react';
import type { TokenScope, UserApiTokenItem } from '@patto-md/shared';
import { KeyIcon, TrashIcon } from '../svg/ActionIcons';

/** トークン一覧コンポーネントの `props` 定義。 */
export interface TokenListProps {
  /** 発行済みトークンの配列。 */
  tokens: UserApiTokenItem[];
  /** トークン失効処理ハンドラー。 */
  onDeleteToken: (tokenId: string) => Promise<void>;
  /** 新規発行モーダル表示ハンドラー。 */
  onCreateClick: () => void;
  /** 現在失効処理中のトークンID(未処理時は `null`)。 */
  isDeletingId: string | null;
}

/**
 * 日時文字列から相対時間(例: 「3分前」「2日前」)または絶対日時を計算する。
 *
 * @param isoDateString - ISO 8601形式の日時文字列。
 * @returns 表示用の日本語文字列。
 */
function formatRelativeTime(isoDateString: string): string {
  const targetTime = new Date(isoDateString).getTime();
  const diffMs = Date.now() - targetTime;

  if (Number.isNaN(targetTime)) {
    return '-';
  }

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) {
    return '1分未満前';
  }

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}分前`;
  }

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    return `${diffHours}時間前`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return `${diffDays}日前`;
  }

  const date = new Date(isoDateString);
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * 有効期限の表示情報(ラベル、警告状態)を判定する。
 *
 * @param expiresAt - 有効期限のISO 8601文字列(無期限時は `null`)。
 * @returns 表示ラベルと警告判定。
 */
function getExpirationStatus(expiresAt: string | null): {
  label: string;
  isExpired: boolean;
  isWarning: boolean;
} {
  if (!expiresAt) {
    return { label: '無期限', isExpired: false, isWarning: false };
  }

  const expireTime = new Date(expiresAt).getTime();
  const now = Date.now();

  if (expireTime <= now) {
    return { label: '期限切れ', isExpired: true, isWarning: false };
  }

  const diffMs = expireTime - now;
  const diffMinutes = Math.ceil(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffHours < 24) {
    const label =
      diffHours > 0
        ? `残り${diffHours}時間`
        : `残り${Math.max(1, diffMinutes)}分`;
    return { label, isExpired: false, isWarning: true };
  }

  if (diffDays <= 7) {
    return { label: `残り${diffDays}日`, isExpired: false, isWarning: true };
  }

  const date = new Date(expiresAt);
  const formatted = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(
    date.getDate(),
  ).padStart(2, '0')}`;
  return { label: `${formatted}まで`, isExpired: false, isWarning: false };
}

/**
 * スコープのバッジ装飾情報を取得する。
 *
 * @param scope - 認可スコープ。
 * @returns ラベルとCSSクラス。
 */
function getScopeBadge(scope: TokenScope): {
  label: string;
  className: string;
} {
  switch (scope) {
    case 'documents:read':
      return {
        label: 'read',
        className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      };
    case 'documents:write':
      return {
        label: 'write',
        className: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
      };
    case 'documents:delete':
      return {
        label: 'delete',
        className: 'bg-red-500/10 text-red-400 border-red-500/20',
      };
    default:
      return {
        label: scope,
        className: 'bg-neutral-800 text-neutral-400 border-neutral-700',
      };
  }
}

/**
 * 発行済みパーソナルアクセストークン一覧を表示するコンポーネント。
 *
 * デスクトップテーブルとモバイルカードの両方に対応し、行内での失効確認を提供する。
 */
export const TokenList: React.FC<TokenListProps> = ({
  tokens,
  onDeleteToken,
  onCreateClick,
  isDeletingId,
}) => {
  const [confirmingTokenId, setConfirmingTokenId] = useState<string | null>(
    null,
  );

  if (tokens.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-800 bg-neutral-900/30 px-6 py-12 text-center">
        <div className="mb-3 rounded-full bg-neutral-800/80 p-3 text-neutral-400">
          <KeyIcon className="size-6" />
        </div>
        <h3 className="text-sm font-semibold text-neutral-200">
          パーソナルアクセストークンは未発行です。
        </h3>
        <p className="mt-1 max-w-md text-xs text-neutral-400">
          CLIツールや外部スクリプト、AIエージェントからTurnstileボット認証なしでドキュメントを公開・更新するためのトークンを発行できます。
        </p>
        <button
          type="button"
          onClick={onCreateClick}
          className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 focus:ring-2 focus:ring-blue-400 focus:outline-none"
        >
          ＋ 新規トークンを発行
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="hidden overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/40 md:block">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-neutral-800 bg-neutral-900/80 text-neutral-400">
            <tr>
              <th className="px-4 py-3 font-medium">トークン名</th>
              <th className="px-4 py-3 font-medium">プレフィックス / マスク</th>
              <th className="px-4 py-3 font-medium">スコープ</th>
              <th className="px-4 py-3 font-medium">有効期限</th>
              <th className="px-4 py-3 font-medium">最終利用</th>
              <th className="px-4 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800/60">
            {tokens.map((token) => {
              const expiration = getExpirationStatus(token.expiresAt);
              const isConfirming = confirmingTokenId === token.id;
              const isDeleting = isDeletingId === token.id;

              return (
                <React.Fragment key={token.id}>
                  <tr className="transition-colors hover:bg-neutral-800/30">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-neutral-100">
                        {token.name}
                      </div>
                      <div className="text-[11px] text-neutral-500">
                        作成: {formatRelativeTime(token.createdAt)}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-neutral-300">
                      <span className="rounded border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-[11px]">
                        {token.tokenMasked}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {token.scopes.map((scope) => {
                          const badge = getScopeBadge(scope);
                          return (
                            <span
                              key={scope}
                              className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`font-medium ${
                          expiration.isExpired
                            ? 'text-red-400'
                            : expiration.isWarning
                              ? 'text-amber-400'
                              : 'text-neutral-300'
                        }`}
                      >
                        {expiration.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-400">
                      {token.lastUsedAt
                        ? formatRelativeTime(token.lastUsedAt)
                        : '未使用'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmingTokenId(isConfirming ? null : token.id)
                        }
                        disabled={isDeleting}
                        className="inline-flex items-center gap-1 rounded border border-neutral-800 bg-neutral-900 px-2.5 py-1 text-xs text-neutral-400 transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                        title="トークンを失効"
                      >
                        <TrashIcon className="size-3.5" />
                        <span>失効</span>
                      </button>
                    </td>
                  </tr>

                  {isConfirming && (
                    <tr className="bg-red-950/20">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-xs text-red-300">
                            トークン「
                            <strong className="text-red-200">
                              {token.name}
                            </strong>
                            」を失効させますか?
                            このトークンを利用している外部クライアントからのアクセスは即座に停止します。
                          </p>
                          <div className="flex items-center gap-2 self-end sm:self-auto">
                            <button
                              type="button"
                              onClick={() => setConfirmingTokenId(null)}
                              disabled={isDeleting}
                              className="rounded border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300 transition-colors hover:bg-neutral-700 disabled:opacity-50"
                            >
                              キャンセル
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                await onDeleteToken(token.id);
                                setConfirmingTokenId(null);
                              }}
                              disabled={isDeleting}
                              className="inline-flex items-center gap-1 rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-50"
                            >
                              {isDeleting ? '失効中...' : '失効する'}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 md:hidden">
        {tokens.map((token) => {
          const expiration = getExpirationStatus(token.expiresAt);
          const isConfirming = confirmingTokenId === token.id;
          const isDeleting = isDeletingId === token.id;

          return (
            <div
              key={token.id}
              className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-xs"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-neutral-100">
                    {token.name}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-neutral-400">
                    {token.tokenMasked}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setConfirmingTokenId(isConfirming ? null : token.id)
                  }
                  disabled={isDeleting}
                  className="rounded border border-neutral-800 bg-neutral-900 p-1.5 text-neutral-400 transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                  aria-label="トークンを失効"
                >
                  <TrashIcon className="size-4" />
                </button>
              </div>

              <div className="flex flex-wrap gap-1">
                {token.scopes.map((scope) => {
                  const badge = getScopeBadge(scope);
                  return (
                    <span
                      key={scope}
                      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  );
                })}
              </div>

              <div className="flex items-center justify-between border-t border-neutral-800/60 pt-2 text-[11px] text-neutral-400">
                <div>
                  有効期限:{' '}
                  <span
                    className={
                      expiration.isExpired
                        ? 'font-medium text-red-400'
                        : expiration.isWarning
                          ? 'font-medium text-amber-400'
                          : 'text-neutral-300'
                    }
                  >
                    {expiration.label}
                  </span>
                </div>
                <div>
                  最終利用:{' '}
                  <span className="text-neutral-300">
                    {token.lastUsedAt
                      ? formatRelativeTime(token.lastUsedAt)
                      : '未使用'}
                  </span>
                </div>
              </div>

              {isConfirming && (
                <div className="space-y-2 rounded-lg border border-red-500/30 bg-red-950/20 p-3">
                  <p className="text-[11px] text-red-300">
                    このトークンを失効させますか? この操作は取り消せません。
                  </p>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmingTokenId(null)}
                      disabled={isDeleting}
                      className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300"
                    >
                      キャンセル
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await onDeleteToken(token.id);
                        setConfirmingTokenId(null);
                      }}
                      disabled={isDeleting}
                      className="rounded bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-500"
                    >
                      {isDeleting ? '失効中...' : '失効する'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-neutral-500">
        ※
        最終利用日時はデータベース書き込み負荷軽減のため、最大5分程度の更新遅延があります。
      </p>
    </div>
  );
};
