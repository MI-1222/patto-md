import { useState, useEffect, useRef, useCallback, type FC } from 'react';
import type { DocumentResponse } from '@patto-md/shared';
import {
  EDIT_TOKEN_PATTERN,
  MODIFY_TOKEN_PATTERN,
  MAX_TITLE_LENGTH,
  MAX_TOTAL_FILE_SIZE,
} from '@patto-md/shared';
import {
  getDocumentTokens,
  hasModifyPermission,
  saveDocumentTokens,
  consumeTokenFromUrlHash,
} from '../../lib/storage';
import {
  executeUpdatePipeline,
  type ExistingAttachmentItem,
} from '../../lib/api/update';
import { renderMarkdown } from '../../lib/markdown';
import { TurnstileWidget } from '../turnstile';
import { EditIcon, KeyIcon, TrashIcon, CloudUploadSvg } from '../svg';

/** `DocumentEditContainer` コンポーネントのプロパティ定義。 */
export interface DocumentEditContainerProps {
  /** サーバーサイドで取得されたドキュメント初期データ。 */
  initialDocument: DocumentResponse;
  /** Cloudflare Turnstile サイトキー。 */
  turnstileSiteKey: string;
  /** APIベースURL。 */
  apiBaseUrl?: string;
}

/**
 * ドキュメント編集画面の統合コンテナコンポーネント。
 *
 * クライアントサイドでの認可ガード（トークン検証）、タイトル・Markdown本文の編集、
 * 新規画像の追加ドロップ、リアルタイムプレビュー、および更新パイプラインの実行を統合制御する。
 */
export const DocumentEditContainer: FC<DocumentEditContainerProps> = ({
  initialDocument,
  turnstileSiteKey,
  apiBaseUrl,
}) => {
  const [hasPermission, setHasPermission] = useState<boolean>(false);
  const [isAuthChecked, setIsAuthChecked] = useState<boolean>(false);
  const [manualToken, setManualToken] = useState<string>('');
  const [manualTokenError, setManualTokenError] = useState<string | null>(null);

  const [title, setTitle] = useState<string>(initialDocument.title);
  const [markdownContent, setMarkdownContent] = useState<string>(
    initialDocument.content,
  );
  const [existingAttachments, setExistingAttachments] = useState<
    ExistingAttachmentItem[]
  >(initialDocument.attachments);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');

  const [previewHtml, setPreviewHtml] = useState<string>('');

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [progressMessage, setProgressMessage] = useState<string>('');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  /** 未保存変更が存在するかどうかの判定フラグ。 */
  const isDirty =
    title !== initialDocument.title ||
    markdownContent !== initialDocument.content ||
    newFiles.length > 0 ||
    existingAttachments.length !== initialDocument.attachments.length;

  useEffect(() => {
    consumeTokenFromUrlHash(initialDocument.id);
    const permitted = hasModifyPermission(initialDocument.id);
    setHasPermission(permitted);
    setIsAuthChecked(true);
  }, [initialDocument.id]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isDirty && !isSubmitting) {
        event.preventDefault();
        event.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isDirty, isSubmitting]);

  useEffect(() => {
    let isCancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { html } = await renderMarkdown(markdownContent, {
          assetBaseUrl: apiBaseUrl,
        });
        if (!isCancelled) {
          setPreviewHtml(html);
        }
      } catch (error) {
        console.error('プレビュー生成エラー:', error);
      }
    }, 150);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [markdownContent, apiBaseUrl]);

  /** 手動入力された認可トークンを検証・保存して適用するハンドラー。 */
  const handleApplyManualToken = useCallback(() => {
    const trimmed = manualToken.trim();
    if (!trimmed) {
      setManualTokenError('トークンを入力してください。');
      return;
    }

    if (
      !EDIT_TOKEN_PATTERN.test(trimmed) &&
      !MODIFY_TOKEN_PATTERN.test(trimmed)
    ) {
      setManualTokenError('無効なトークン形式です。');
      return;
    }

    const isEdit = EDIT_TOKEN_PATTERN.test(trimmed);
    saveDocumentTokens(initialDocument.id, {
      editToken: isEdit ? trimmed : undefined,
      modifyToken: !isEdit ? trimmed : undefined,
    });

    setManualTokenError(null);
    setHasPermission(true);
  }, [manualToken, initialDocument.id]);

  /** 画像ファイルのドラッグ＆ドロップを受け付けるハンドラー。 */
  const handleFileDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files).filter((file) =>
        file.type.startsWith('image/'),
      );
      if (droppedFiles.length > 0) {
        setNewFiles((prev) => [...prev, ...droppedFiles]);
      }
    }
  }, []);

  /** ファイル選択ダイアログからの画像追加ハンドラー。 */
  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        const selected = Array.from(e.target.files).filter((file) =>
          file.type.startsWith('image/'),
        );
        if (selected.length > 0) {
          setNewFiles((prev) => [...prev, ...selected]);
        }
      }
    },
    [],
  );

  /** 新規追加された画像ファイルを一覧から除外するハンドラー。 */
  const handleRemoveNewFile = useCallback((index: number) => {
    setNewFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  /** 既存の添付ファイルを維持対象から除外するハンドラー。 */
  const handleRemoveExistingAttachment = useCallback((id: string) => {
    setExistingAttachments((prev) => prev.filter((att) => att.id !== id));
  }, []);

  /** 画像のMarkdown参照リンクを本文末尾に挿入するハンドラー。 */
  const handleInsertImageLink = useCallback(
    (fileName: string, isExisting: boolean = false, r2Key?: string) => {
      const linkText =
        isExisting && r2Key
          ? `\n\n![${fileName}](/api/assets/${r2Key})\n`
          : `\n\n![${fileName}](${fileName})\n`;
      setMarkdownContent((prev) => prev + linkText);
    },
    [],
  );

  /** 編集を破棄して閲覧画面へ戻るキャンセルハンドラー。 */
  const handleCancel = useCallback(() => {
    if (
      isDirty &&
      !window.confirm('編集内容が破棄されますが、閲覧画面へ戻りますか？')
    ) {
      return;
    }
    window.location.href = `/p/${initialDocument.id}`;
  }, [isDirty, initialDocument.id]);

  /** 更新パイプラインを実行してドキュメントを更新保存するハンドラー。 */
  const handleSave = useCallback(async () => {
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      setErrorMessage('タイトルを入力してください。');
      return;
    }

    if (markdownContent.trim().length === 0) {
      setErrorMessage('本文を入力してください。');
      return;
    }

    const totalAttachmentSize =
      existingAttachments.reduce((sum, att) => sum + att.fileSize, 0) +
      newFiles.reduce((sum, file) => sum + file.size, 0);

    if (totalAttachmentSize > MAX_TOTAL_FILE_SIZE) {
      setErrorMessage('添付ファイルの合計サイズが上限(30MB)を超過しています。');
      return;
    }

    const tokens = getDocumentTokens(initialDocument.id);
    const token = tokens?.editToken || tokens?.modifyToken;
    if (!token) {
      setErrorMessage('有効な編集権限トークンが見つかりません。');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setProgressMessage('更新処理を開始中...');
    setProgressPercent(5);

    try {
      await executeUpdatePipeline({
        documentId: initialDocument.id,
        token,
        title: trimmedTitle,
        markdownContent,
        existingAttachments,
        newFiles,
        expiresAt: initialDocument.expiresAt,
        createdAt: initialDocument.createdAt,
        turnstileToken: turnstileToken || undefined,
        baseUrl: apiBaseUrl,
        onProgress: (p) => {
          setProgressMessage(p.message);
          setProgressPercent(p.percent);
        },
      });

      window.location.href = `/p/${initialDocument.id}?t=${Date.now()}`;
    } catch (error) {
      console.error('更新保存エラー:', error);
      const message =
        error instanceof Error ? error.message : '更新に失敗しました。';
      setErrorMessage(message);
      setIsSubmitting(false);
    }
  }, [
    title,
    markdownContent,
    initialDocument.id,
    existingAttachments,
    newFiles,
    turnstileToken,
    apiBaseUrl,
  ]);

  if (!isAuthChecked) {
    return (
      <div className="flex min-h-75 items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-2 border-neutral-600 border-t-neutral-100" />
      </div>
    );
  }

  if (!hasPermission) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-neutral-800 bg-neutral-900/60 p-6 text-neutral-100 shadow-2xl backdrop-blur-sm sm:p-8">
        <div className="flex items-center gap-3 border-b border-neutral-800 pb-4">
          <KeyIcon className="size-6 text-amber-400" />
          <h2 className="text-xl font-bold">編集権限がありません。</h2>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-neutral-300">
          このドキュメントを編集するには、編集権限（<code>edit</code> または{' '}
          <code>modify</code> トークン）が必要です。
          別のブラウザで公開した場合は、発行された管理URLからアクセスするか、トークンを手動で入力してください。
        </p>

        <div className="mt-6 space-y-3 rounded-lg border border-neutral-800 bg-neutral-950/60 p-4">
          <label
            htmlFor="manual-token-input"
            className="block text-xs font-medium text-neutral-400"
          >
            トークン手動入力
          </label>
          <input
            id="manual-token-input"
            type="text"
            value={manualToken}
            onChange={(e) => setManualToken(e.target.value)}
            placeholder="pt_edt_... または pt_mod_..."
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
          />
          {manualTokenError && (
            <p className="text-xs text-rose-400">{manualTokenError}</p>
          )}
          <button
            type="button"
            onClick={handleApplyManualToken}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
          >
            トークンを適用して編集を開始
          </button>
        </div>

        <div className="mt-6 flex justify-end">
          <a
            href={`/p/${initialDocument.id}`}
            className="rounded-md border border-neutral-700 px-4 py-2 text-sm text-neutral-300 transition-colors hover:bg-neutral-800"
          >
            閲覧画面へ戻る
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-neutral-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1">
          <label htmlFor="document-title-input" className="sr-only">
            タイトル
          </label>
          <input
            id="document-title-input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MAX_TITLE_LENGTH}
            placeholder="ドキュメントのタイトルを入力..."
            className="w-full rounded-lg border border-neutral-800 bg-neutral-900/60 px-4 py-2 text-xl font-bold text-neutral-100 placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isSubmitting}
            className="rounded-lg border border-neutral-700 px-4 py-2 text-sm font-medium text-neutral-300 transition-colors hover:bg-neutral-800 disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <div className="size-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                <span>保存中...</span>
              </>
            ) : (
              <>
                <EditIcon className="size-4" />
                <span>更新を保存</span>
              </>
            )}
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="rounded-lg border border-rose-800/60 bg-rose-950/40 p-4 text-sm text-rose-300">
          {errorMessage}
        </div>
      )}

      {isSubmitting && (
        <div className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-900/80 p-4">
          <div className="flex justify-between text-xs text-neutral-400">
            <span>{progressMessage}</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex border-b border-neutral-800 md:hidden">
        <button
          type="button"
          onClick={() => setActiveTab('edit')}
          className={`flex-1 border-b-2 py-2 text-center text-sm font-medium transition-colors ${
            activeTab === 'edit'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-neutral-400 hover:text-neutral-200'
          }`}
        >
          編集
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('preview')}
          className={`flex-1 border-b-2 py-2 text-center text-sm font-medium transition-colors ${
            activeTab === 'preview'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-neutral-400 hover:text-neutral-200'
          }`}
        >
          プレビュー
        </button>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
        <div
          className={`space-y-4 ${
            activeTab === 'edit' ? 'block' : 'hidden md:block'
          }`}
        >
          <div className="flex items-center justify-between">
            <label
              htmlFor="markdown-editor-textarea"
              className="text-sm font-medium text-neutral-300"
            >
              Markdown本文
            </label>
            <span className="text-xs text-neutral-500">
              {markdownContent.length} 文字
            </span>
          </div>

          <textarea
            id="markdown-editor-textarea"
            value={markdownContent}
            onChange={(e) => setMarkdownContent(e.target.value)}
            rows={18}
            className="w-full resize-y rounded-xl border border-neutral-800 bg-neutral-950 p-4 font-mono text-sm leading-relaxed text-neutral-200 placeholder-neutral-600 focus:border-blue-500 focus:outline-none"
            placeholder="Markdownを入力..."
          />

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleFileDrop}
            onClick={() => fileInputRef.current?.click()}
            className="cursor-pointer rounded-xl border-2 border-dashed border-neutral-800 bg-neutral-900/30 p-4 text-center transition-colors hover:border-neutral-600"
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              onChange={handleFileInputChange}
              className="hidden"
            />
            <CloudUploadSvg className="mx-auto size-8 text-neutral-400" />
            <p className="mt-2 text-xs font-medium text-neutral-300">
              追加する画像をドラッグ＆ドロップ、またはクリックして選択
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              PNG, JPEG, WebP, GIF, SVG (合計最大30MB)
            </p>
          </div>

          {newFiles.length > 0 && (
            <div className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
              <h4 className="text-xs font-semibold tracking-wider text-neutral-400 uppercase">
                新規追加画像 ({newFiles.length})
              </h4>
              <ul className="space-y-2">
                {newFiles.map((file, idx) => (
                  <li
                    key={`${file.name}-${idx}`}
                    className="flex items-center justify-between rounded-lg border border-neutral-800/80 bg-neutral-950/60 px-3 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="truncate font-mono text-neutral-200">
                        {file.name}
                      </span>
                      <span className="shrink-0 text-neutral-500">
                        ({(file.size / 1024).toFixed(1)} KB)
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleInsertImageLink(file.name, false)}
                        className="rounded bg-neutral-800 px-2 py-1 text-neutral-300 transition-colors hover:bg-neutral-700"
                      >
                        本文に挿入
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveNewFile(idx)}
                        className="p-1 text-neutral-500 transition-colors hover:text-rose-400"
                        aria-label="削除"
                      >
                        <TrashIcon className="size-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {existingAttachments.length > 0 && (
            <div className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
              <h4 className="text-xs font-semibold tracking-wider text-neutral-400 uppercase">
                登録済みの添付ファイル ({existingAttachments.length})
              </h4>
              <ul className="space-y-2">
                {existingAttachments.map((att) => (
                  <li
                    key={att.id}
                    className="flex items-center justify-between rounded-lg border border-neutral-800/80 bg-neutral-950/60 px-3 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="truncate font-mono text-neutral-200">
                        {att.fileName}
                      </span>
                      <span className="shrink-0 text-neutral-500">
                        ({(att.fileSize / 1024).toFixed(1)} KB)
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          handleInsertImageLink(att.fileName, true, att.r2Key)
                        }
                        className="rounded bg-neutral-800 px-2 py-1 text-neutral-300 transition-colors hover:bg-neutral-700"
                      >
                        本文に挿入
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveExistingAttachment(att.id)}
                        className="p-1 text-neutral-500 transition-colors hover:text-rose-400"
                        aria-label="削除"
                      >
                        <TrashIcon className="size-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div
          className={`space-y-4 ${
            activeTab === 'preview' ? 'block' : 'hidden md:block'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-neutral-300">
              リアルタイムプレビュー
            </span>
          </div>

          <div className="min-h-125 rounded-xl border border-neutral-800 bg-neutral-900/40 p-6 backdrop-blur-sm">
            <h1 className="mb-6 border-b border-neutral-800 pb-4 text-2xl font-bold tracking-tight text-neutral-100">
              {title || '無題のドキュメント'}
            </h1>
            <article
              className="prose max-w-none text-neutral-200 prose-invert prose-headings:font-bold prose-headings:tracking-tight prose-headings:text-neutral-100 prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline prose-code:rounded prose-code:bg-neutral-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:font-mono prose-code:text-sm prose-code:text-neutral-200 prose-pre:border prose-pre:border-neutral-800 prose-pre:bg-neutral-950/80 prose-table:overflow-x-auto prose-img:rounded-lg [&>h1:first-child]:hidden"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        </div>
      </div>

      {turnstileSiteKey && (
        <div className="flex justify-end pt-2">
          <TurnstileWidget
            siteKey={turnstileSiteKey}
            onSuccess={(token) => setTurnstileToken(token)}
            onExpire={() => setTurnstileToken('')}
            onError={() => setTurnstileToken('')}
            size="compact"
          />
        </div>
      )}
    </div>
  );
};
