import { useState } from 'react';
import { useFileDrop } from './useFileDrop';
import { useMarkdownReconcile } from './useMarkdownReconcile';
import { useDocumentPublish } from './useDocumentPublish';
import { DropZone } from './DropZone';
import { SelectedFileList } from './SelectedFileList';
import { MissingAssetsModal } from './MissingAssetsModal';

/**
 * 作成画面全体のファイル受付と状態管理を担うコンテナコンポーネント。
 * Reactアイランドとして動作し、ブラウザイベント、AST解析、仮想ファイルマップ突合、
 * およびDirect Uploadとコミット処理のパイプラインを統合管理する。
 *
 * @returns 作成画面のUIコンテナ。
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
    handleAppendDrop,
    handleAppendFileInputChange,
    resetFiles,
  } = useFileDrop();

  const {
    parseResult,
    markdownContent,
    reconciliation,
    previewUrlMap,
    isResolving,
    isReadyToPublish,
  } = useMarkdownReconcile(parsedFiles);

  const {
    progressMessage,
    progressPercent,
    errorMessage: publishErrorMessage,
    isPublishing,
    publish,
    resetPublishState,
  } = useDocumentPublish();

  const [isMissingModalOpen, setIsMissingModalOpen] = useState(false);

  const isReady =
    status === 'ready' &&
    (parsedFiles.markdownFile !== null || parsedFiles.assetFiles.size > 0);

  const missingAssets = reconciliation?.missing || [];

  const handleReset = () => {
    resetPublishState();
    resetFiles();
  };

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
          <SelectedFileList
            parsedFiles={parsedFiles}
            reconciliation={reconciliation}
            previewUrlMap={previewUrlMap}
            ast={parseResult?.ast || null}
            title={parseResult?.title || null}
            isResolving={isResolving}
            isReadyToPublish={isReadyToPublish}
            isPublishing={isPublishing}
            progressMessage={progressMessage}
            progressPercent={progressPercent}
            publishErrorMessage={publishErrorMessage}
            onOpenMissingModal={() => setIsMissingModalOpen(true)}
            onReset={handleReset}
            onPublishClick={async ({ expiration, allowIncompletePublish }) => {
              await publish({
                parsedFiles,
                reconciliation,
                parseResult,
                markdownContent,
                expiration,
                allowIncompletePublish,
              });
            }}
          />

          {!isPublishing && (
            <div className="pt-2">
              <DropZone
                status={status}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleAppendDrop}
                onFileInputChange={handleAppendFileInputChange}
              />
            </div>
          )}
        </div>
      )}

      {/* 不足画像追加入力モーダル */}
      <MissingAssetsModal
        isOpen={isMissingModalOpen}
        onClose={() => setIsMissingModalOpen(false)}
        missingAssets={missingAssets}
        onAppendDrop={async (e) => {
          await handleAppendDrop(e);
          // 追加後に未解決画像が0件になった場合はモーダルを閉じる。
        }}
        onAppendFileInputChange={handleAppendFileInputChange}
      />
    </div>
  );
}
