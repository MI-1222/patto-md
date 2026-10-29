import { useFileDrop } from './useFileDrop';
import { DropZone } from './DropZone';
import { SelectedFileList } from './SelectedFileList';

/**
 * 作成画面全体のファイル受付・状態管理コンテナコンポーネント。
 * Reactアイランドとして動作し、ブラウザイベントおよび状態を管理する。
 *
 * @returns 作成画面UIコンテナ。
 */
export function DropZoneContainer() {
  const {
    status,
    parsedFiles,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleFileInputChange,
    resetFiles,
  } = useFileDrop();

  const isReady =
    status === 'ready' &&
    (parsedFiles.markdownFile !== null || parsedFiles.assetFiles.size > 0);

  return (
    <div className="w-full">
      {!isReady ? (
        <DropZone
          status={status}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onFileInputChange={handleFileInputChange}
        />
      ) : (
        <div className="space-y-6 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 sm:p-8">
          <SelectedFileList parsedFiles={parsedFiles} onReset={resetFiles} />

          {/* 追加ドロップゾーン(補足受付用) */}
          <div className="pt-2">
            <DropZone
              status={status}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onFileInputChange={handleFileInputChange}
            />
          </div>
        </div>
      )}
    </div>
  );
}
