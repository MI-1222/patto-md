import React, { useState, useCallback, useMemo } from 'react';
import {
  CopyIcon,
  CheckIcon,
  LinkIcon,
  ClockIcon,
  RawTextIcon,
} from '../svg/ActionIcons';

/** ドキュメント閲覧アクションバーのProps定義。 */
export interface DocumentActionBarProps {
  /** ドキュメントID(Slug)。 */
  documentId: string;
  /** Markdown本文のテキスト。 */
  rawMarkdown: string;
  /** 有効期限日時文字列(ISO 8601形式、無期限時は `null`)。 */
  expiresAt: string | null;
  /** 作成日時文字列(ISO 8601形式)。 */
  createdAt: string;
}

/** コピー状態の種別定義。 */
type CopyTarget = 'markdown' | 'url' | null;

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
 * Markdownのコピー、共有URLのコピー、Raw表示、有効期限バッジの表示を提供する。
 */
export const DocumentActionBar: React.FC<DocumentActionBarProps> = ({
  rawMarkdown,
  expiresAt,
  createdAt,
}) => {
  const [copiedTarget, setCopiedTarget] = useState<CopyTarget>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  /** コピー完了通知メッセージを設定し、2秒後に自動消去する。 */
  const triggerCopyFeedback = useCallback(
    (target: CopyTarget, message: string) => {
      setCopiedTarget(target);
      setFeedbackMessage(message);

      window.setTimeout(() => {
        setCopiedTarget((current) => (current === target ? null : current));
        setFeedbackMessage((current) => (current === message ? null : current));
      }, 2000);
    },
    [],
  );

  /** Markdown本文をクリップボードへコピーし、完了フィードバックを表示する。 */
  const handleCopyMarkdown = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(rawMarkdown);
      triggerCopyFeedback('markdown', 'Markdownをコピーしました。');
    } catch (_error) {
      triggerCopyFeedback('markdown', 'コピーに失敗しました。');
    }
  }, [rawMarkdown, triggerCopyFeedback]);

  /** ドキュメント共有URLをクリップボードへコピーし、完了フィードバックを表示する。 */
  const handleCopyUrl = useCallback(async () => {
    try {
      const shareUrl = window.location.href;
      await navigator.clipboard.writeText(shareUrl);
      triggerCopyFeedback('url', 'URLをコピーしました。');
    } catch (_error) {
      triggerCopyFeedback('url', 'コピーに失敗しました。');
    }
  }, [triggerCopyFeedback]);

  /** Markdown本文からBlob URLを生成し、別タブでプレーンテキストを開く。 */
  const handleOpenRaw = useCallback(() => {
    const blob = new Blob([rawMarkdown], {
      type: 'text/markdown;charset=utf-8',
    });
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, '_blank', 'noopener,noreferrer');
  }, [rawMarkdown]);

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

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 bg-neutral-900/60 px-4 py-3 backdrop-blur-md sm:px-6">
      <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-400">
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
      </div>

      <div className="flex items-center gap-2">
        {feedbackMessage && (
          <span className="animate-fade-in mr-1 text-xs text-emerald-400">
            {feedbackMessage}
          </span>
        )}

        <button
          type="button"
          onClick={handleCopyMarkdown}
          className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-800/80 px-2.5 py-1.5 text-xs font-medium text-neutral-200 transition-colors hover:border-neutral-600 hover:bg-neutral-700 focus:ring-1 focus:ring-blue-500 focus:outline-none"
          title="Markdown本文をクリップボードにコピー"
        >
          {copiedTarget === 'markdown' ? (
            <CheckIcon className="size-3.5 text-emerald-400" />
          ) : (
            <CopyIcon className="size-3.5 text-neutral-400" />
          )}
          <span>{copiedTarget === 'markdown' ? 'コピー完了' : 'Markdown'}</span>
        </button>

        <button
          type="button"
          onClick={handleCopyUrl}
          className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-800/80 px-2.5 py-1.5 text-xs font-medium text-neutral-200 transition-colors hover:border-neutral-600 hover:bg-neutral-700 focus:ring-1 focus:ring-blue-500 focus:outline-none"
          title="共有リンクURLをコピー"
        >
          {copiedTarget === 'url' ? (
            <CheckIcon className="size-3.5 text-emerald-400" />
          ) : (
            <LinkIcon className="size-3.5 text-neutral-400" />
          )}
          <span>{copiedTarget === 'url' ? 'コピー完了' : 'URL共有'}</span>
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
  );
};
