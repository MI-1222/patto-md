import { useState, useRef } from 'react';
import type { Root } from 'mdast';
import type { DocumentVisibility, ExpirationPreset } from '@patto-md/shared';
import {
  FileDocumentSvg,
  ImageSvg,
  CloseSvg,
  CheckSvg,
  WarningSvg,
  SpinnerSvg,
} from '../svg/FileIcons';
import { EyeIcon, EyeSlashIcon, LockIcon } from '../svg/ActionIcons';
import { PublishSvg } from '../svg/PublishIcon';
import { MarkdownPreview } from './MarkdownPreview';
import { TurnstileWidget, type TurnstileWidgetHandle } from '../turnstile';
import type { ParsedFiles, VirtualFile } from './types';
import type { ReconciliationResult } from '../../lib/markdown';

/**
 * ファイルサイズを人間が読みやすい形式に変換する。
 *
 * @param bytes - バイト数。
 * @returns フォーマット済み文字列(例: "1.2 MB")。
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

/** 有効期限プリセットの選択肢定義。 */
const EXPIRATION_OPTIONS: { value: ExpirationPreset; label: string }[] = [
  { value: '1day', label: '24時間' },
  { value: '7days', label: '7日間 (推奨)' },
  { value: '30days', label: '30日間' },
  { value: 'never', label: '無期限' },
];

/** 公開範囲の選択肢定義。 */
const VISIBILITY_OPTIONS: { value: DocumentVisibility; label: string }[] = [
  { value: 'public', label: '全体公開' },
  { value: 'unlisted', label: '限定公開 (URL知人のみ)' },
  { value: 'protected', label: 'パスコード保護' },
];

/** 選択済みファイル一覧プレビューコンポーネントのプロパティ定義。 */
interface SelectedFileListProps {
  /** パース済みファイル群。 */
  parsedFiles: ParsedFiles;
  /** 突合結果オブジェクト。 */
  reconciliation: ReconciliationResult | null;
  /** プレビュー用URLマップ。 */
  previewUrlMap: Map<string, string>;
  /** MDAST構文木ルート。 */
  ast: Root | null;
  /** ドキュメントタイトル。 */
  title: string | null;
  /** 突合・解析中フラグ。 */
  isResolving: boolean;
  /** 公開準備完了フラグ。 */
  isReadyToPublish: boolean;
  /** 不足画像モーダル表示ハンドラー。 */
  onOpenMissingModal: () => void;
  /** リセットハンドラー。 */
  onReset: () => void;
  /** 公開処理の実行中フラグ。 */
  isPublishing?: boolean;
  /** 公開処理の進捗メッセージ。 */
  progressMessage?: string;
  /** 公開処理の進捗率 (0〜100)。 */
  progressPercent?: number;
  /** 公開処理のエラーメッセージ。 */
  publishErrorMessage?: string | null;
  /** 公開実行時のコールバック関数。 */
  onPublishClick?: (options: {
    expiration: ExpirationPreset;
    visibility: DocumentVisibility;
    passcode?: string;
    allowIncompletePublish: boolean;
    turnstileToken?: string;
  }) => void;
}

/**
 * 選択・投入されたファイル一覧およびプレビューを表示するコンポーネント。
 *
 * @param props - コンポーネントのプロパティ。
 * @returns ファイル一覧およびプレビューUI。
 */
export function SelectedFileList({
  parsedFiles,
  reconciliation,
  previewUrlMap,
  ast,
  title,
  isResolving,
  isReadyToPublish: _isReadyToPublish,
  onOpenMissingModal,
  onReset,
  isPublishing = false,
  progressMessage = '',
  progressPercent = 0,
  publishErrorMessage = null,
  onPublishClick,
}: SelectedFileListProps) {
  const {
    markdownFile,
    assetFiles,
    totalSize,
    isTotalSizeExceeded,
    hasInvalidFiles,
  } = parsedFiles;

  const [activeTab, setActiveTab] = useState<'files' | 'preview'>('files');
  const [allowIncompletePublish, setAllowIncompletePublish] = useState(false);
  const [expiration, setExpiration] = useState<ExpirationPreset>('7days');
  const [visibility, setVisibility] = useState<DocumentVisibility>('public');
  const [passcode, setPasscode] = useState('');
  const [showPasscode, setShowPasscode] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);

  const assetList = Array.from(assetFiles.values());
  const missingCount = reconciliation?.missing.length || 0;
  const missingPaths = new Set(
    reconciliation?.missing.map((m) => m.cleanPath) || [],
  );

  /** パスコード保護設定時の入力値バリデーション。 */
  const isPasscodeValid =
    visibility !== 'protected' ||
    (passcode.trim().length >= 4 && passcode.trim().length <= 32);

  /** ファイル構成要件(Markdown存在、制約違反なし、画像突合完了または未解決許容)の充足判定。 */
  const isFilesReady =
    markdownFile !== null &&
    !hasInvalidFiles &&
    reconciliation !== null &&
    (reconciliation.isComplete || allowIncompletePublish);

  /** ボット検証トークンを含めた最終的な公開可否判定。 */
  const canPublish = isFilesReady && Boolean(turnstileToken) && isPasscodeValid;

  /**
   * 公開処理を実行する。
   * トークン消費後のリトライに備えてウィジェットを即座にリセットし、親の公開処理を呼び出す。
   */
  const handlePublish = () => {
    if (!canPublish || isResolving || isPublishing) {
      return;
    }

    const currentToken = turnstileToken;
    setTurnstileToken(null);
    turnstileRef.current?.reset();

    onPublishClick?.({
      expiration,
      visibility,
      passcode: visibility === 'protected' ? passcode.trim() : undefined,
      allowIncompletePublish,
      turnstileToken: currentToken || undefined,
    });
  };

  return (
    <div className="space-y-6">
      {/* 全体サマリーおよびタブ切替 */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-800 pb-4">
        <div>
          <h2 className="text-base font-bold text-neutral-100">
            受け付けたドキュメント
          </h2>
          <p className="mt-0.5 text-xs text-neutral-400">
            合計: {assetList.length + (markdownFile ? 1 : 0)} 件 (
            <span
              className={
                isTotalSizeExceeded
                  ? 'font-bold text-red-400'
                  : 'text-neutral-300'
              }
            >
              {formatFileSize(totalSize)}
            </span>
            )
          </p>
        </div>

        {/* タブ切り替えコントロール */}
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-neutral-800 bg-neutral-950 p-0.5 text-xs">
            <button
              type="button"
              disabled={isPublishing}
              onClick={() => setActiveTab('files')}
              className={`rounded-md px-3 py-1 font-medium transition-colors ${
                activeTab === 'files'
                  ? 'bg-neutral-800 text-neutral-100 shadow-xs'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              ファイル構成
            </button>
            <button
              type="button"
              disabled={isPublishing}
              onClick={() => setActiveTab('preview')}
              className={`rounded-md px-3 py-1 font-medium transition-colors ${
                activeTab === 'preview'
                  ? 'bg-neutral-800 text-neutral-100 shadow-xs'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              プレビュー
            </button>
          </div>

          <button
            type="button"
            disabled={isPublishing}
            onClick={onReset}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700/80 bg-neutral-800/60 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-600 hover:bg-neutral-800 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CloseSvg className="size-3.5" />
            <span>選び直す</span>
          </button>
        </div>
      </div>

      {/* 制約違反エラー警告表示 */}
      {hasInvalidFiles && (
        <div className="rounded-lg border border-red-500/30 bg-red-950/20 p-3 text-xs text-red-300">
          <p className="font-semibold">一部のファイルに問題があります。</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-red-400/90">
            {isTotalSizeExceeded && (
              <li>全体の合計サイズが上限を超過しています。</li>
            )}
            {markdownFile?.isSizeExceeded && (
              <li>Markdownファイルのサイズが上限(10MB)を超過しています。</li>
            )}
            {assetList.some((f) => f.isSizeExceeded) && (
              <li>単一ファイルサイズの上限を超過している画像があります。</li>
            )}
            {assetList.some((f) => f.isTypeUnsupported) && (
              <li>サポートされていない形式のファイルが含まれています。</li>
            )}
          </ul>
        </div>
      )}

      {/* 未解決画像アラートバナー */}
      {missingCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-950/20 p-3.5 text-xs text-amber-300">
          <div className="flex items-center gap-2.5">
            <WarningSvg className="size-5 shrink-0 text-amber-400" />
            <div>
              <p className="font-semibold">
                未解決の画像が {missingCount} 件あります。
              </p>
              <p className="mt-0.5 text-amber-400/80">
                ドキュメント内で参照されている画像が見つかりません。追加ドロップで補うことができます。
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isPublishing}
            onClick={onOpenMissingModal}
            className="shrink-0 rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            不足画像を追加する
          </button>
        </div>
      )}

      {/* タブコンテンツ */}
      {activeTab === 'files' ? (
        <div className="space-y-6">
          {/* Markdownファイル表示 */}
          <div className="space-y-2">
            <span className="text-xs font-semibold tracking-wider text-neutral-400 uppercase">
              Markdownドキュメント
            </span>
            {markdownFile ? (
              <div className="flex items-center justify-between rounded-xl border border-blue-500/30 bg-blue-950/10 p-3.5 sm:p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-600/20 text-blue-400">
                    <FileDocumentSvg className="size-5" />
                  </div>
                  <div className="min-w-0 truncate">
                    <p className="truncate text-sm font-semibold text-neutral-100">
                      {markdownFile.relativePath}
                    </p>
                    <p className="text-xs text-neutral-400">
                      {formatFileSize(markdownFile.file.size)}
                      {title ? ` • タイトル: "${title}"` : ''}
                    </p>
                  </div>
                </div>
                {markdownFile.isSizeExceeded && (
                  <span className="shrink-0 rounded bg-red-900/60 px-2 py-0.5 text-[11px] font-medium text-red-300">
                    サイズ超過
                  </span>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-amber-500/40 bg-amber-950/10 p-4 text-xs text-amber-300">
                Markdownファイル (.md)
                が含まれていません。Markdownファイルをドロップしてください。
              </div>
            )}
          </div>

          {/* 添付アセット一覧 */}
          {assetList.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold tracking-wider text-neutral-400 uppercase">
                  添付アセット画像 ({assetList.length}件)
                </span>
                {reconciliation && (
                  <span className="text-[11px] text-neutral-400">
                    解決済み: {reconciliation.totalResolvedCount}件 / 未参照:{' '}
                    {reconciliation.unused.length}件
                  </span>
                )}
              </div>

              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {assetList.map((asset: VirtualFile) => {
                  const resolvedAsset = reconciliation?.resolved.get(
                    asset.relativePath,
                  );
                  const isResolved = Boolean(resolvedAsset);
                  const blobUrl = previewUrlMap.get(asset.relativePath);
                  const isUnused = reconciliation?.unused.some(
                    (u) => u.relativePath === asset.relativePath,
                  );

                  return (
                    <div
                      key={asset.relativePath}
                      className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900/40 p-2.5 text-xs transition-colors hover:border-neutral-700"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        {/* サムネイルまたはアイコンプレビュー */}
                        <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded bg-neutral-800 text-neutral-400">
                          {blobUrl ? (
                            <img
                              src={blobUrl}
                              alt={asset.relativePath}
                              className="size-full object-cover"
                            />
                          ) : (
                            <ImageSvg className="size-4" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <p className="truncate font-mono text-neutral-200">
                            {asset.relativePath}
                          </p>
                          <div className="flex items-center gap-2 text-[11px] text-neutral-500">
                            <span>{formatFileSize(asset.file.size)}</span>
                            {isResolved && (
                              <span className="inline-flex items-center gap-1 text-emerald-400">
                                <CheckSvg className="size-3" />
                                <span>解決済み</span>
                              </span>
                            )}
                            {isUnused && (
                              <span className="text-neutral-500">
                                (本文未参照・除外)
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2 pl-2">
                        {asset.isSizeExceeded && (
                          <span className="rounded bg-red-900/60 px-1.5 py-0.5 text-[10px] text-red-300">
                            サイズ超過
                          </span>
                        )}
                        {asset.isTypeUnsupported && (
                          <span className="rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] text-amber-300">
                            非対応形式
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ドキュメントプレビュータブ */
        <MarkdownPreview
          title={title}
          ast={ast}
          previewUrlMap={previewUrlMap}
          missingPaths={missingPaths}
        />
      )}

      {/* 未解決画像が存在する場合のエスケープハッチ */}
      {missingCount > 0 && !hasInvalidFiles && (
        <div className="flex items-center gap-2.5 rounded-lg border border-neutral-800 bg-neutral-900/50 p-3 text-xs text-neutral-300">
          <input
            id="allow-incomplete"
            type="checkbox"
            disabled={isPublishing}
            checked={allowIncompletePublish}
            onChange={(e) => setAllowIncompletePublish(e.target.checked)}
            className="size-4 rounded border-neutral-700 bg-neutral-800 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <label
            htmlFor="allow-incomplete"
            className="cursor-pointer text-neutral-300 select-none"
          >
            不足画像をリンク切れのまま公開することを許可する
          </label>
        </div>
      )}

      {publishErrorMessage && (
        <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-3.5 text-xs text-red-300">
          <p className="font-semibold">公開処理に失敗しました。</p>
          <p className="mt-1 text-red-400">{publishErrorMessage}</p>
        </div>
      )}

      <div className="flex justify-center border-t border-neutral-800/60 pt-4">
        <TurnstileWidget
          ref={turnstileRef}
          theme="dark"
          size="flexible"
          onSuccess={(token) => {
            setTurnstileToken(token);
          }}
          onExpire={() => {
            setTurnstileToken(null);
          }}
          onError={() => {
            setTurnstileToken(null);
          }}
        />
      </div>

      {/* 公開アクションエリア */}
      <div className="flex flex-col gap-4 border-t border-neutral-800 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          {isPublishing ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-neutral-300">
                <span className="font-medium">{progressMessage}</span>
                <span className="font-mono text-neutral-400">
                  {progressPercent}%
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
                <div
                  className="h-full bg-blue-500 transition-all duration-300 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          ) : !canPublish ? (
            <p className="text-xs text-amber-400/90">
              {markdownFile === null
                ? 'Markdownファイルをドロップしてください。'
                : missingCount > 0 && !allowIncompletePublish
                  ? `未解決の画像が ${missingCount} 件残っています。不足ファイルを追加するか、そのまま公開にチェックを入れてください。`
                  : hasInvalidFiles
                    ? 'ファイルエラーを解消してください。'
                    : !isPasscodeValid
                      ? 'パスコードは4〜32文字で入力してください。'
                      : isFilesReady && !turnstileToken
                        ? 'ボット検証(認証)を行っています...'
                        : 'ファイルを解決中...'}
            </p>
          ) : (
            <p className="text-xs text-emerald-400">
              {missingCount > 0
                ? `未解決画像が ${missingCount} 件ありますが、公開準備が整いました。`
                : 'すべての画像が正常に解決されました。公開可能です。'}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <label
              htmlFor="visibility-select"
              className="text-xs text-neutral-400"
            >
              公開範囲:
            </label>
            <select
              id="visibility-select"
              disabled={isPublishing}
              value={visibility}
              onChange={(e) =>
                setVisibility(e.target.value as DocumentVisibility)
              }
              className="rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {VISIBILITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {visibility === 'protected' && (
            <div className="relative flex items-center">
              <span className="pointer-events-none absolute left-2.5 text-neutral-400">
                <LockIcon className="size-3.5" />
              </span>
              <input
                type={showPasscode ? 'text' : 'password'}
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="パスコード (4〜32文字)"
                disabled={isPublishing}
                maxLength={32}
                className="w-44 rounded-lg border border-neutral-700 bg-neutral-900 px-8 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowPasscode(!showPasscode)}
                className="absolute right-2 text-neutral-400 hover:text-neutral-200"
                tabIndex={-1}
              >
                {showPasscode ? (
                  <EyeSlashIcon className="size-3.5" />
                ) : (
                  <EyeIcon className="size-3.5" />
                )}
              </button>
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <label
              htmlFor="expiration-select"
              className="text-xs text-neutral-400"
            >
              有効期限:
            </label>
            <select
              id="expiration-select"
              disabled={isPublishing}
              value={expiration}
              onChange={(e) =>
                setExpiration(e.target.value as ExpirationPreset)
              }
              className="rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {EXPIRATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            disabled={!canPublish || isResolving || isPublishing}
            onClick={handlePublish}
            className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold shadow-md transition-all ${
              canPublish && !isResolving && !isPublishing
                ? 'cursor-pointer bg-blue-600 text-white hover:bg-blue-500 hover:shadow-blue-500/20 active:scale-98'
                : 'cursor-not-allowed bg-neutral-800 text-neutral-500'
            }`}
          >
            {isPublishing ? (
              <>
                <SpinnerSvg className="size-4" />
                <span>公開中...</span>
              </>
            ) : isFilesReady && !turnstileToken ? (
              <>
                <SpinnerSvg className="size-4 animate-spin text-neutral-400" />
                <span>認証中...</span>
              </>
            ) : (
              <>
                <PublishSvg className="size-4" />
                <span>
                  {missingCount > 0 && allowIncompletePublish
                    ? '未解決画像を残してWeb公開する'
                    : 'Web公開する'}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
