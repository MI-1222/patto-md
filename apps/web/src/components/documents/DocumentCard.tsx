import React, { useState, useCallback, useMemo } from 'react';
import type { DocumentListItem } from '@patto-md/shared';
import { fetchDocument } from '../../lib/api';
import {
  LinkIcon,
  MarkdownCopyIcon,
  DownloadIcon,
  CheckIcon,
  ClockIcon,
  PhotoIcon,
} from '../svg/ActionIcons';

/**
 * ドキュメントカードの `props` 定義。
 */
export interface DocumentCardProps {
  /** ドキュメント情報。 */
  document: DocumentListItem;
  /** 閲覧中のブラウザで作成したドキュメントかどうかの真偽値。 */
  isMine?: boolean;
}

/**
 * 有効期限までの残り時間を表示用テキストに変換する。
 *
 * @param expiresAt - 有効期限を示すISO 8601形式の日時文字列。
 * @returns 残り時間の文字列表現。
 */
function formatRemainingTime(expiresAt: string | null): string {
  if (!expiresAt) {
    return '無期限';
  }

  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (diffMs <= 0) {
    return '期限切れ';
  }

  const diffMinutes = Math.floor(diffMs / 60000);
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
 * 作成日時を相対時間(または絶対日付)に変換する。
 *
 * @param dateString - 作成日時を示すISO 8601形式の日時文字列。
 * @returns 相対時間または整形された日付文字列。
 */
function formatRelativeTime(dateString: string): string {
  try {
    const diffMs = Date.now() - new Date(dateString).getTime();
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMinutes < 1) {
      return 'たった今';
    }
    if (diffMinutes < 60) {
      return `${diffMinutes}分前`;
    }
    if (diffHours < 24) {
      return `${diffHours}時間前`;
    }
    if (diffDays < 7) {
      return `${diffDays}日前`;
    }
    return new Date(dateString).toLocaleDateString('ja-JP');
  } catch {
    return dateString;
  }
}

/**
 * 公開ドキュメントカードコンポーネント。
 *
 * カード全面を閲覧リンクとし、URLコピー、Markdownコピー、
 * Markdownダウンロードの各アクションボタンを前面(z-10)に配置する。
 */
export const DocumentCard: React.FC<DocumentCardProps> = ({
  document: doc,
  isMine = false,
}) => {
  const [urlCopied, setUrlCopied] = useState<boolean>(false);
  const [markdownCopied, setMarkdownCopied] = useState<boolean>(false);
  const [isCopyingMarkdown, setIsCopyingMarkdown] = useState<boolean>(false);
  const [isDownloaded, setIsDownloaded] = useState<boolean>(false);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);

  const documentUrl = `/p/${doc.id}`;

  /**
   * ドキュメントの共有URLをクリップボードにコピーする。
   *
   * @param event - クリックイベントオブジェクト。
   */
  const handleCopyUrl = useCallback(
    async (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();

      try {
        const fullUrl = `${window.location.origin}${documentUrl}`;
        await navigator.clipboard.writeText(fullUrl);
        setUrlCopied(true);
        setTimeout(() => setUrlCopied(false), 2000);
      } catch (error) {
        console.error('URLコピーに失敗。', error);
      }
    },
    [documentUrl],
  );

  /**
   * ドキュメントのMarkdown本文を取得し、クリップボードにコピーする。
   *
   * @param event - クリックイベントオブジェクト。
   */
  const handleCopyMarkdown = useCallback(
    async (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (isCopyingMarkdown) return;
      setIsCopyingMarkdown(true);

      try {
        const result = await fetchDocument(doc.id);
        await navigator.clipboard.writeText(result.document.content);
        setMarkdownCopied(true);
        setTimeout(() => setMarkdownCopied(false), 2000);
      } catch (error) {
        console.error('Markdownコピーに失敗。', error);
      } finally {
        setIsCopyingMarkdown(false);
      }
    },
    [doc.id, isCopyingMarkdown],
  );

  /**
   * ドキュメントのMarkdown本文を取得し、ローカルファイルとしてダウンロードする。
   *
   * @param event - クリックイベントオブジェクト。
   */
  const handleDownloadMarkdown = useCallback(
    async (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (isDownloading) return;
      setIsDownloading(true);

      try {
        const result = await fetchDocument(doc.id);
        const blob = new Blob([result.document.content], {
          type: 'text/markdown;charset=utf-8',
        });
        const blobUrl = URL.createObjectURL(blob);
        const link = window.document.createElement('a');
        link.href = blobUrl;
        const sanitizedTitle = doc.title.replace(/[\\/:*?"<>|]/g, '_');
        link.download = sanitizedTitle.endsWith('.md')
          ? sanitizedTitle
          : `${sanitizedTitle}.md`;
        link.click();
        URL.revokeObjectURL(blobUrl);

        setIsDownloaded(true);
        setTimeout(() => setIsDownloaded(false), 2000);
      } catch (error) {
        console.error('Markdownダウンロードに失敗。', error);
      } finally {
        setIsDownloading(false);
      }
    },
    [doc.id, doc.title, isDownloading],
  );

  const remaining = useMemo(
    () => formatRemainingTime(doc.expiresAt),
    [doc.expiresAt],
  );
  const isExpiringSoon =
    doc.expiresAt !== null &&
    new Date(doc.expiresAt).getTime() - Date.now() < 1000 * 60 * 60 * 24;

  return (
    <article className="group relative flex flex-col justify-between rounded-xl border border-neutral-800 bg-neutral-900/40 p-5 transition-all duration-200 hover:border-blue-500/40 hover:bg-neutral-900/80 hover:shadow-[0_0_20px_-5px_rgba(59,130,246,0.15)]">
      <div className="space-y-3">
        {/* 上段: バッジとアクションボタン群(z-10で前面化) */}
        <div className="relative z-10 flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {isMine && (
              <span className="inline-flex items-center rounded-md border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-400">
                あなたの投稿
              </span>
            )}
            <span
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px] ${
                isExpiringSoon
                  ? 'border-amber-500/20 bg-amber-500/10 text-amber-300'
                  : 'border-neutral-700/60 bg-neutral-800/80 text-neutral-300'
              }`}
            >
              <ClockIcon className="size-3 text-neutral-400" />
              {remaining}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleCopyUrl}
              className="flex size-7 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950/70 text-neutral-300 transition-colors hover:border-neutral-700 hover:bg-neutral-800 hover:text-neutral-100"
              title={urlCopied ? 'コピー完了' : 'URLをコピー'}
              aria-label="URLをコピー"
            >
              {urlCopied ? (
                <CheckIcon className="size-3.5 text-emerald-400" />
              ) : (
                <LinkIcon className="size-3.5 text-neutral-400" />
              )}
            </button>

            <button
              type="button"
              onClick={handleCopyMarkdown}
              disabled={isCopyingMarkdown}
              className="flex size-7 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950/70 text-neutral-300 transition-colors hover:border-neutral-700 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-50"
              title={markdownCopied ? 'コピー完了' : 'Markdownをコピー'}
              aria-label="Markdownをコピー"
            >
              {markdownCopied ? (
                <CheckIcon className="size-3.5 text-emerald-400" />
              ) : (
                <MarkdownCopyIcon className="size-3.5 text-neutral-400" />
              )}
            </button>
          </div>
        </div>

        {/* タイトル: Stretched Link によりカード全面が遷移対象 */}
        <h2 className="line-clamp-2 text-base font-bold tracking-tight text-neutral-100 transition-colors group-hover:text-blue-400 sm:text-lg">
          <a
            href={documentUrl}
            className="after:absolute after:inset-0 after:z-0 focus:underline focus:outline-none"
          >
            {doc.title}
          </a>
        </h2>

        {/* 抜粋 */}
        {doc.description && (
          <p className="line-clamp-2 text-xs leading-relaxed text-neutral-400">
            {doc.description}
          </p>
        )}
      </div>

      {/* 下段: メタ情報とダウンロードボタン(z-10) */}
      <div className="relative z-10 mt-4 flex items-center justify-between border-t border-neutral-800/80 pt-3 text-xs text-neutral-500">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-neutral-600">
            #{doc.id}
          </span>
          <span className="text-neutral-700">•</span>
          <time
            dateTime={doc.createdAt}
            title={new Date(doc.createdAt).toLocaleString('ja-JP')}
            className="font-mono text-[11px] text-neutral-400"
          >
            {formatRelativeTime(doc.createdAt)}
          </time>
        </div>

        <div className="flex items-center gap-2">
          {doc.attachmentCount > 0 && (
            <span
              className="flex items-center gap-1 text-[11px] text-neutral-400"
              title={`添付画像 ${doc.attachmentCount}件`}
            >
              <PhotoIcon className="size-3.5 text-neutral-400" />
              <span className="font-mono">{doc.attachmentCount}</span>
            </span>
          )}

          <button
            type="button"
            onClick={handleDownloadMarkdown}
            disabled={isDownloading}
            className="flex size-7 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950/70 text-neutral-400 transition-colors hover:border-neutral-700 hover:bg-neutral-800 hover:text-blue-400 disabled:opacity-50"
            title={isDownloaded ? 'ダウンロード完了' : 'Markdownをダウンロード'}
            aria-label="Markdownをダウンロード"
          >
            {isDownloaded ? (
              <CheckIcon className="size-3.5 text-emerald-400" />
            ) : (
              <DownloadIcon className="size-3.5" />
            )}
          </button>
        </div>
      </div>
    </article>
  );
};
