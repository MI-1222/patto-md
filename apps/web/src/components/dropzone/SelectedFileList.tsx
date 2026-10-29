import { FileDocumentSvg, ImageSvg, CloseSvg } from '../svg/FileIcons';
import type { ParsedFiles, VirtualFile } from './types';

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

/** 選択済みファイル一覧プレビューコンポーネントのプロパティ定義。 */
interface SelectedFileListProps {
  /** パース済みファイル群。 */
  parsedFiles: ParsedFiles;
  /** リセットハンドラー。 */
  onReset: () => void;
}

/**
 * 選択・投入されたファイル一覧を表示するプレビューコンポーネント。
 *
 * @param props - コンポーネントプロパティ。
 * @returns ファイル一覧表示UI。
 */
export function SelectedFileList({
  parsedFiles,
  onReset,
}: SelectedFileListProps) {
  const {
    markdownFile,
    assetFiles,
    totalSize,
    isTotalSizeExceeded,
    hasInvalidFiles,
  } = parsedFiles;

  const assetList = Array.from(assetFiles.values());

  return (
    <div className="space-y-6">
      {/* 全体サマリーおよびアクション */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 pb-4">
        <div>
          <h2 className="text-base font-bold text-neutral-100">
            受け付けたファイル
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

        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700/80 bg-neutral-800/60 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-600 hover:bg-neutral-800 hover:text-neutral-100"
        >
          <CloseSvg className="size-3.5" />
          <span>クリアして選び直す</span>
        </button>
      </div>

      {/* エラー警告表示 */}
      {hasInvalidFiles && (
        <div className="rounded-lg border border-red-500/30 bg-red-950/20 p-3 text-xs text-red-300">
          <p className="font-semibold">一部のファイルに問題があります。</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-red-400/90">
            {isTotalSizeExceeded && (
              <li>全体の合計サイズが30MBを超過しています。</li>
            )}
            {markdownFile?.isSizeExceeded && (
              <li>Markdownファイルのサイズが10MBを超過しています。</li>
            )}
            {assetList.some((f) => f.isSizeExceeded) && (
              <li>単一ファイルサイズが10MBを超過している画像があります。</li>
            )}
            {assetList.some((f) => f.isTypeUnsupported) && (
              <li>サポートされていない形式のファイルが含まれています。</li>
            )}
          </ul>
        </div>
      )}

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
          <span className="text-xs font-semibold tracking-wider text-neutral-400 uppercase">
            添付アセット画像 ({assetList.length}件)
          </span>
          <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1">
            {assetList.map((asset: VirtualFile) => (
              <div
                key={asset.relativePath}
                className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-xs"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded bg-neutral-800 text-neutral-400">
                    <ImageSvg className="size-4" />
                  </div>
                  <span className="truncate font-mono text-neutral-300">
                    {asset.relativePath}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2 pl-2">
                  <span className="font-mono text-neutral-500">
                    {formatFileSize(asset.file.size)}
                  </span>
                  {asset.isSizeExceeded && (
                    <span className="rounded bg-red-900/60 px-1.5 py-0.5 text-[10px] text-red-300">
                      10MB超過
                    </span>
                  )}
                  {asset.isTypeUnsupported && (
                    <span className="rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] text-amber-300">
                      非対応形式
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
