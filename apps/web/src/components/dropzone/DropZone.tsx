import { useRef } from 'react';
import { CloudUploadSvg } from '../svg/CloudUploadIcon';
import type { DropZoneStatus } from './types';

/** ドロップゾーンプレゼンテーションコンポーネントのプロパティ定義。 */
interface DropZoneProps {
  /** 現在のインタラクション状態。 */
  status: DropZoneStatus;
  /** ドラッグ侵入イベントハンドラー。 */
  onDragEnter: (e: React.DragEvent) => void;
  /** ドラッグ退出イベントハンドラー。 */
  onDragLeave: (e: React.DragEvent) => void;
  /** ドラッグオーバーイベントハンドラー。 */
  onDragOver: (e: React.DragEvent) => void;
  /** ドロップイベントハンドラー。 */
  onDrop: (e: React.DragEvent) => void;
  /** ファイル選択変更イベントハンドラー。 */
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

/**
 * D&Dおよびファイル選択を受け付けるドロップゾーンUIコンポーネント。
 *
 * @param props - コンポーネントプロパティ。
 * @returns ドロップゾーンUI。
 */
export function DropZone({
  status,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onFileInputChange,
}: DropZoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isDragOver = status === 'dragover';

  const handleAreaClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={handleAreaClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleAreaClick();
        }
      }}
      className={`group relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-all duration-200 sm:p-12 ${
        isDragOver
          ? 'scale-105 border-blue-500 bg-blue-950/20 shadow-lg shadow-blue-950/40'
          : 'border-neutral-700/80 bg-neutral-900/30 hover:border-neutral-500 hover:bg-neutral-900/60'
      }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".md,.markdown,text/markdown,text/plain,image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        onChange={onFileInputChange}
        className="hidden"
        aria-label="Markdownまたは添付ファイルを選択"
      />

      <div
        className={`pointer-events-none mb-4 flex size-14 items-center justify-center rounded-2xl border transition-colors ${
          isDragOver
            ? 'border-blue-500/50 bg-blue-600/20 text-blue-400'
            : 'border-neutral-800 bg-neutral-800/80 text-neutral-400 group-hover:border-neutral-700 group-hover:text-neutral-200'
        }`}
      >
        <CloudUploadSvg className="size-7" />
      </div>

      <div className="pointer-events-none space-y-1.5">
        <p className="text-base font-semibold text-neutral-100 sm:text-lg">
          Markdownファイルや画像をここにドロップ
        </p>
        <p className="text-xs text-neutral-400 sm:text-sm">
          または
          <span className="mx-1 font-medium text-blue-400 underline underline-offset-2">
            ファイルを選択
          </span>
          (フォルダ内の画像も同時に受け付けます)
        </p>
      </div>

      <div className="pointer-events-none mt-6 flex flex-wrap items-center justify-center gap-2 text-[11px] text-neutral-500">
        <span className="rounded border border-neutral-800 bg-neutral-900/80 px-2 py-0.5">
          .md / .markdown
        </span>
        <span className="rounded border border-neutral-800 bg-neutral-900/80 px-2 py-0.5">
          PNG / JPEG / WebP / GIF / SVG
        </span>
        <span className="rounded border border-neutral-800 bg-neutral-900/80 px-2 py-0.5">
          単一最大 10MB
        </span>
        <span className="rounded border border-neutral-800 bg-neutral-900/80 px-2 py-0.5">
          合計最大 30MB
        </span>
      </div>
    </div>
  );
}
