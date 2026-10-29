import { useState, useRef } from 'react';
import { CloseSvg, WarningSvg, ImageSvg } from '../svg/FileIcons';
import { UploadSvg } from '../svg/UploadIcon';
import type { MissingAsset } from '../../lib/markdown';

/** 未解決画像追加入力モーダルのプロパティ定義。 */
interface MissingAssetsModalProps {
  /** 開閉状態。 */
  isOpen: boolean;
  /** モーダルを閉じるハンドラー。 */
  onClose: () => void;
  /** 未解決アセット一覧。 */
  missingAssets: MissingAsset[];
  /** 追加入力ドロップハンドラー。 */
  onAppendDrop: (e: React.DragEvent) => Promise<void> | void;
  /** 追加入力ファイル選択ハンドラー。 */
  onAppendFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

/**
 * 未解決画像が存在する場合に表示する追加入力モーダルUI。
 * 不足している相対パスやMarkdown内の出現行を提示し、追加ドロップを受け付ける。
 *
 * @param props - コンポーネントのプロパティ。
 * @returns 追加入力モーダル。
 */
export function MissingAssetsModal({
  isOpen,
  onClose,
  missingAssets,
  onAppendDrop,
  onAppendFileInputChange,
}: MissingAssetsModalProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) {
    return null;
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDropInternal = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    await onAppendDrop(e);
  };

  const handleSelectFilesClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs transition-opacity"
      role="dialog"
      aria-modal="true"
      aria-labelledby="missing-assets-title"
    >
      <div className="relative w-full max-w-xl rounded-2xl border border-neutral-700 bg-neutral-900 p-6 shadow-2xl">
        {/* ヘッダー */}
        <div className="flex items-start justify-between gap-4 border-b border-neutral-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
              <WarningSvg className="size-5" />
            </div>
            <div>
              <h3
                id="missing-assets-title"
                className="text-base font-bold text-neutral-100"
              >
                画像ファイルが不足しています
              </h3>
              <p className="mt-0.5 text-xs text-neutral-400">
                Markdown内で参照されている画像のうち、以下のファイルが見つかりません。
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
            aria-label="モーダルを閉じる"
          >
            <CloseSvg className="size-4" />
          </button>
        </div>

        {/* 不足画像一覧 */}
        <div className="mt-4 max-h-48 space-y-2 overflow-y-auto pr-1">
          {missingAssets.map((asset) => {
            const firstRef = asset.refs[0];
            const line = firstRef?.position?.start.line;
            const altText = firstRef?.alt;

            return (
              <div
                key={asset.cleanPath}
                className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-amber-950/10 px-3.5 py-2.5 text-xs"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded bg-amber-900/30 text-amber-400">
                    <ImageSvg className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-mono font-medium text-amber-200">
                      {asset.cleanPath}
                    </p>
                    <p className="text-[11px] text-neutral-400">
                      {line ? `${line}行目で参照` : '本文内で参照'}
                      {altText ? ` (alt: "${altText}")` : ''}
                      {asset.refs.length > 1
                        ? ` 他${asset.refs.length - 1}箇所`
                        : ''}
                    </p>
                  </div>
                </div>

                {asset.reason === 'ambiguous_basename' && (
                  <span className="shrink-0 rounded bg-red-950/60 px-2 py-0.5 text-[10px] text-red-300">
                    同名衝突
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* 追加入力ドロップゾーン */}
        <div className="mt-5">
          <div
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDropInternal}
            onClick={handleSelectFilesClick}
            className={`group flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-all ${
              isDragOver
                ? 'border-blue-500 bg-blue-950/20'
                : 'border-neutral-700 bg-neutral-950/50 hover:border-neutral-600 hover:bg-neutral-800/40'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              onChange={onAppendFileInputChange}
              className="hidden"
            />
            <div className="flex size-10 items-center justify-center rounded-full bg-neutral-800 text-neutral-400 transition-colors group-hover:bg-blue-600/20 group-hover:text-blue-400">
              <UploadSvg className="size-5" />
            </div>
            <p className="mt-3 text-xs font-medium text-neutral-200">
              不足している画像を追加でドロップしてください
            </p>
            <p className="mt-1 text-[11px] text-neutral-400">
              またはクリックして画像ファイルを選択
            </p>
          </div>
        </div>

        {/* フッター */}
        <div className="mt-6 flex items-center justify-end gap-3 border-t border-neutral-800 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-neutral-800 px-4 py-2 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
