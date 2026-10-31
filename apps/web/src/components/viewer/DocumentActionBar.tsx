import React, { useState, useCallback, useMemo, useEffect } from 'react';
import type {
  AuthUser,
  DocumentVisibility,
  OwnerProvider,
} from '@patto-md/shared';
import {
  CopyIcon,
  CheckIcon,
  LinkIcon,
  ClockIcon,
  RawTextIcon,
  EditIcon,
  TrashIcon,
  RenewIcon,
  ShieldCheckIcon,
  KeyIcon,
  LockIcon,
  UserCheckIcon,
} from '../svg/ActionIcons';
import {
  claimDocument,
  fetchCurrentUser,
  getApiBaseUrl,
} from '../../lib/api/client';
import {
  consumeTokenFromUrlHash,
  getDocumentTokenRole,
  getDocumentTokens,
  type DocumentTokenRole,
} from '../../lib/storage';
import { addMyDocumentId } from '../../lib/storage/myDocuments';

/** ドキュメント閲覧アクションバーの `Props` 定義。 */
export interface DocumentActionBarProps {
  /** ドキュメントID(`slug`)。 */
  documentId: string;
  /** Markdown本文のテキスト。 */
  rawMarkdown: string;
  /** 有効期限日時文字列(ISO 8601形式、無期限時は `null`)。 */
  expiresAt: string | null;
  /** 作成日時文字列(ISO 8601形式)。 */
  createdAt: string;
  /** ドキュメント公開範囲(任意)。 */
  visibility?: DocumentVisibility;
  /** 所有者ユーザー識別子(任意)。 */
  ownerUserId?: string | null;
  /** 所有者プロバイダ種別(任意)。 */
  ownerProvider?: OwnerProvider | null;
  /** 編集ボタン押下時のコールバック(任意)。 */
  onEdit?: () => void;
  /** 有効期限延長ボタン押下時のコールバック(任意)。 */
  onRenew?: () => void;
  /** 削除ボタン押下時のコールバック(任意)。 */
  onDelete?: () => void;
}

/** コピーおよび操作状態のフィードバック種別定義。 */
type FeedbackTarget =
  'markdown' | 'url' | 'admin-url' | 'action' | 'claim' | null;

/**
 * 有効期限までの残り時間を表示用テキストに変換する。
 *
 * @param expiresAt - 有効期限を示すISO 8601形式の日時文字列。無期限時は `null`。
 * @returns 残り時間の文字列表現。
 */
function formatRemainingTime(expiresAt: string | null): string {
  if (!expiresAt) {
    return '無期限';
  }

  const expireTime = new Date(expiresAt).getTime();
  const nowTime = Date.now();
  const diffMs = expireTime - nowTime;

  if (diffMs <= 0) {
    return '期限切れ';
  }

  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `残り ${diffDays}日`;
  }
  if (diffHours > 0) {
    return `残り ${diffHours}時間`;
  }
  return `残り ${Math.max(1, diffMinutes)}分`;
}

/**
 * 作成日時を表示用の日付形式(`YYYY/MM/DD`)に変換する。
 *
 * @param createdAt - 作成日時を示すISO 8601形式の日時文字列。
 * @returns 整形された日付文字列。
 */
function formatDate(createdAt: string): string {
  try {
    const date = new Date(createdAt);
    return date.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return createdAt;
  }
}

/**
 * ドキュメント閲覧用のアクションバーコンポーネント。
 *
 * 閲覧者向けのアクション(Markdownコピー、URL共有、Raw表示)に加え、
 * クライアントの保持トークンに応じた作成者・編集者向け管理メニューを動的に提供する。
 */
export const DocumentActionBar: React.FC<DocumentActionBarProps> = ({
  documentId,
  rawMarkdown,
  expiresAt,
  createdAt,
  visibility,
  ownerUserId,
  ownerProvider,
  onEdit,
  onRenew,
  onDelete,
}) => {
  const [feedbackTarget, setFeedbackTarget] = useState<FeedbackTarget>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [tokenRole, setTokenRole] = useState<DocumentTokenRole>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [claimedOwner, setClaimedOwner] = useState<{
    ownerUserId: string;
    ownerProvider: OwnerProvider;
  } | null>(
    ownerUserId && ownerProvider ? { ownerUserId, ownerProvider } : null,
  );
  const [isClaiming, setIsClaiming] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);

  useEffect(() => {
    consumeTokenFromUrlHash(documentId);
    const role = getDocumentTokenRole(documentId);
    setTokenRole(role);
    setIsMounted(true);

    fetchCurrentUser().then((user) => {
      setCurrentUser(user);
    });
  }, [documentId]);

  /** コピー完了通知メッセージを設定し、2秒後に自動消去する。 */
  const triggerFeedback = useCallback(
    (target: FeedbackTarget, message: string) => {
      setFeedbackTarget(target);
      setFeedbackMessage(message);

      window.setTimeout(() => {
        setFeedbackTarget((current) => (current === target ? null : current));
        setFeedbackMessage((current) => (current === message ? null : current));
      }, 2000);
    },
    [],
  );

  /** Markdown本文をクリップボードへコピーし、完了フィードバックを表示する。 */
  const handleCopyMarkdown = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(rawMarkdown);
      triggerFeedback('markdown', 'Markdownをコピーしました。');
    } catch (_error) {
      triggerFeedback('markdown', 'コピーに失敗しました。');
    }
  }, [rawMarkdown, triggerFeedback]);

  /**
   * ドキュメント共有URLをクリップボードへコピーする。
   * トークン漏洩防止のため、ハッシュを除いた正規パーマリンクをコピーする。
   */
  const handleCopyUrl = useCallback(async () => {
    try {
      const shareUrl =
        typeof window !== 'undefined'
          ? `${window.location.origin}${window.location.pathname}`
          : '';
      await navigator.clipboard.writeText(shareUrl);
      triggerFeedback('url', 'URLをコピーしました。');
    } catch (_error) {
      triggerFeedback('url', 'コピーに失敗しました。');
    }
  }, [triggerFeedback]);

  /** 特権管理URL(別ブラウザ共有用ハッシュ付き)をクリップボードへコピーする。 */
  const handleCopyAdminUrl = useCallback(async () => {
    try {
      const tokens = getDocumentTokens(documentId);
      if (!tokens?.editToken) {
        triggerFeedback('admin-url', '管理トークンが見つかりません。');
        return;
      }
      const adminUrl = `${window.location.origin}${window.location.pathname}#edit_token=${tokens.editToken}`;
      await navigator.clipboard.writeText(adminUrl);
      triggerFeedback('admin-url', '管理用URLをコピーしました。');
    } catch (_error) {
      triggerFeedback('admin-url', 'コピーに失敗しました。');
    }
  }, [documentId, triggerFeedback]);

  /** Markdown本文からBlob URLを生成し、別タブでプレーンテキストを開く。 */
  const handleOpenRaw = useCallback(() => {
    const blob = new Blob([rawMarkdown], {
      type: 'text/markdown;charset=utf-8',
    });
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, '_blank', 'noopener,noreferrer');
  }, [rawMarkdown]);

  /** 編集操作のハンドラー。 */
  const handleEdit = useCallback(() => {
    if (onEdit) {
      onEdit();
    } else if (typeof window !== 'undefined') {
      window.location.href = `/p/${documentId}/edit`;
    }
  }, [documentId, onEdit]);

  /** 有効期限延長操作のハンドラー。 */
  const handleRenew = useCallback(() => {
    if (onRenew) {
      onRenew();
    } else {
      triggerFeedback('action', '有効期限の延長機能は準備中です。');
    }
  }, [onRenew, triggerFeedback]);

  /** 削除操作のハンドラー。 */
  const handleDelete = useCallback(() => {
    if (onDelete) {
      onDelete();
    } else {
      triggerFeedback('action', 'ドキュメント削除機能は準備中です。');
    }
  }, [onDelete, triggerFeedback]);

  /** 匿名ドキュメントの所有権をアカウントへ移譲するハンドラー。 */
  const handleClaim = useCallback(async () => {
    if (!currentUser) {
      setShowLoginModal(true);
      return;
    }

    const tokens = getDocumentTokens(documentId);
    if (!tokens?.editToken) {
      triggerFeedback('claim', '特権管理トークンが見つかりません。');
      return;
    }

    setIsClaiming(true);
    try {
      const res = await claimDocument(documentId, tokens.editToken);
      setClaimedOwner({
        ownerUserId: res.ownerUserId,
        ownerProvider: res.ownerProvider,
      });
      addMyDocumentId(documentId);
      triggerFeedback('claim', 'アカウントに保存しました。');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '所有権の移譲に失敗しました。';
      triggerFeedback('claim', message);
    } finally {
      setIsClaiming(false);
    }
  }, [currentUser, documentId, triggerFeedback]);

  /** 有効期限の残り時間表示テキスト。 */
  const remainingText = useMemo(
    () => formatRemainingTime(expiresAt),
    [expiresAt],
  );

  /** 日本語ロケールで整形した公開日文字列。 */
  const formattedCreatedDate = useMemo(
    () => formatDate(createdAt),
    [createdAt],
  );

  const isOwner = tokenRole === 'edit';
  const isEditor = tokenRole === 'modify';
  const hasManagementPermission = isOwner || isEditor;

  return (
    <div className="flex flex-col border-b border-neutral-800 bg-neutral-900/60 backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-2.5 text-xs text-neutral-400">
          <span>公開日: {formattedCreatedDate}</span>
          <span className="text-neutral-700">•</span>
          <div
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
              expiresAt === null
                ? 'bg-neutral-800 text-neutral-300'
                : remainingText === '期限切れ'
                  ? 'bg-red-500/10 text-red-400'
                  : 'bg-amber-500/10 text-amber-300'
            }`}
          >
            <ClockIcon className="size-3" />
            <span>{remainingText}</span>
          </div>

          {visibility === 'protected' && (
            <div
              className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300"
              title="パスコードで保護されたドキュメント"
            >
              <LockIcon className="size-3 text-amber-400" />
              <span>保護中</span>
            </div>
          )}

          {isMounted && hasManagementPermission && (
            <div
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-opacity duration-300 ${
                isOwner
                  ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                  : 'border border-cyan-500/20 bg-cyan-500/10 text-cyan-300'
              }`}
            >
              {isOwner ? (
                <>
                  <ShieldCheckIcon className="size-3 text-emerald-400" />
                  <span>作成者</span>
                </>
              ) : (
                <>
                  <KeyIcon className="size-3 text-cyan-400" />
                  <span>共同編集</span>
                </>
              )}
            </div>
          )}

          {isMounted && isOwner && claimedOwner && (
            <div
              className="inline-flex items-center gap-1 rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-xs font-medium text-purple-300"
              title="アカウント連携済みドキュメント"
            >
              <UserCheckIcon className="size-3 text-purple-400" />
              <span>アカウント所有</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {feedbackMessage && (
            <span className="animate-fade-in mr-1 text-xs text-emerald-400">
              {feedbackMessage}
            </span>
          )}

          {isMounted && hasManagementPermission && (
            <div className="flex items-center gap-1.5 border-r border-neutral-700/60 pr-2">
              <button
                type="button"
                onClick={handleEdit}
                className="inline-flex items-center gap-1 rounded-md border border-blue-500/30 bg-blue-500/10 px-2.5 py-1.5 text-xs font-medium text-blue-300 transition-colors hover:border-blue-500/50 hover:bg-blue-500/20 focus:ring-1 focus:ring-blue-500 focus:outline-none"
                title="ドキュメント本文を編集"
              >
                <EditIcon className="size-3.5 text-blue-400" />
                <span>編集</span>
              </button>

              {isOwner && (
                <>
                  {!claimedOwner && (
                    <button
                      type="button"
                      onClick={handleClaim}
                      disabled={isClaiming}
                      className="inline-flex items-center gap-1 rounded-md border border-purple-500/30 bg-purple-500/10 px-2.5 py-1.5 text-xs font-medium text-purple-300 transition-colors hover:border-purple-500/50 hover:bg-purple-500/20 focus:ring-1 focus:ring-purple-500 focus:outline-none disabled:opacity-50"
                      title="このドキュメントをアカウントの管理下に保存"
                    >
                      <UserCheckIcon className="size-3.5 text-purple-400" />
                      <span>{isClaiming ? '保存中...' : 'アカウント保存'}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleRenew}
                    className="inline-flex items-center gap-1 rounded-md border border-neutral-700 bg-neutral-800/80 px-2.5 py-1.5 text-xs font-medium text-neutral-200 transition-colors hover:border-neutral-600 hover:bg-neutral-700 focus:ring-1 focus:ring-blue-500 focus:outline-none"
                    title="ドキュメントの有効期限を延長"
                  >
                    <RenewIcon className="size-3.5 text-neutral-300" />
                    <span>延長</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyAdminUrl}
                    className="inline-flex items-center gap-1 rounded-md border border-neutral-700 bg-neutral-800/80 px-2.5 py-1.5 text-xs font-medium text-neutral-200 transition-colors hover:border-neutral-600 hover:bg-neutral-700 focus:ring-1 focus:ring-blue-500 focus:outline-none"
                    title="管理権限付きURLをコピー(他端末引き継ぎ用)"
                  >
                    <KeyIcon className="size-3.5 text-amber-400" />
                    <span>
                      {feedbackTarget === 'admin-url'
                        ? 'コピー完了'
                        : '管理URL'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDelete}
                    className="inline-flex items-center gap-1 rounded-md border border-red-500/20 bg-red-500/10 px-2.5 py-1.5 text-xs font-medium text-red-300 transition-colors hover:border-red-500/40 hover:bg-red-500/20 focus:ring-1 focus:ring-red-500 focus:outline-none"
                    title="ドキュメントを削除"
                  >
                    <TrashIcon className="size-3.5 text-red-400" />
                    <span>削除</span>
                  </button>
                </>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={handleCopyMarkdown}
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-800/80 px-2.5 py-1.5 text-xs font-medium text-neutral-200 transition-colors hover:border-neutral-600 hover:bg-neutral-700 focus:ring-1 focus:ring-blue-500 focus:outline-none"
            title="Markdown本文をクリップボードにコピー"
          >
            {feedbackTarget === 'markdown' ? (
              <CheckIcon className="size-3.5 text-emerald-400" />
            ) : (
              <CopyIcon className="size-3.5 text-neutral-400" />
            )}
            <span>
              {feedbackTarget === 'markdown' ? 'コピー完了' : 'Markdown'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleCopyUrl}
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-800/80 px-2.5 py-1.5 text-xs font-medium text-neutral-200 transition-colors hover:border-neutral-600 hover:bg-neutral-700 focus:ring-1 focus:ring-blue-500 focus:outline-none"
            title="共有リンクURLをコピー(ハッシュなし)"
          >
            {feedbackTarget === 'url' ? (
              <CheckIcon className="size-3.5 text-emerald-400" />
            ) : (
              <LinkIcon className="size-3.5 text-neutral-400" />
            )}
            <span>{feedbackTarget === 'url' ? 'コピー完了' : 'URL共有'}</span>
          </button>

          <button
            type="button"
            onClick={handleOpenRaw}
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-800/80 px-2.5 py-1.5 text-xs font-medium text-neutral-200 transition-colors hover:border-neutral-600 hover:bg-neutral-700 focus:ring-1 focus:ring-blue-500 focus:outline-none"
            title="別タブでMarkdownプレーンテキストを表示"
          >
            <RawTextIcon className="size-3.5 text-neutral-400" />
            <span>Raw</span>
          </button>
        </div>
      </div>

      {showLoginModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
            <h3 className="text-base font-semibold text-neutral-100">
              アカウントに保存
            </h3>
            <p className="mt-2 text-xs text-neutral-400">
              ドキュメントをアカウントに保存すると、別の端末からでも管理・編集できるようになります。
            </p>
            <div className="mt-5 space-y-2.5">
              <a
                href={`${getApiBaseUrl()}/api/auth/github?return_to=${encodeURIComponent(
                  typeof window !== 'undefined'
                    ? window.location.pathname + window.location.hash
                    : '',
                )}`}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-neutral-800 px-4 py-2.5 text-xs font-medium text-neutral-200 transition-colors hover:bg-neutral-700"
              >
                <span>GitHubでログインして保存</span>
              </a>
              <a
                href={`${getApiBaseUrl()}/api/auth/discord?return_to=${encodeURIComponent(
                  typeof window !== 'undefined'
                    ? window.location.pathname + window.location.hash
                    : '',
                )}`}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#5865F2]/20 px-4 py-2.5 text-xs font-medium text-[#5865F2] transition-colors hover:bg-[#5865F2]/30"
              >
                <span>Discordでログインして保存</span>
              </a>
            </div>
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => setShowLoginModal(false)}
                className="text-xs text-neutral-500 hover:text-neutral-300"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
