import { useEffect, useRef, useState, useCallback } from 'react';
import {
  MAX_SINGLE_FILE_SIZE,
  MAX_TOTAL_FILE_SIZE,
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_TEXT_MIME_TYPES,
} from '@patto-md/shared';
import type { VirtualFile, ParsedFiles, DropZoneStatus } from './types';

/**
 * ファイルがMarkdown形式であるかを判定する。
 *
 * @param file - 判定対象ファイル。
 * @returns Markdownファイルの場合はtrue。
 */
function isMarkdownFile(file: File): boolean {
  const extension = file.name.toLowerCase().split('.').pop();
  return (
    extension === 'md' ||
    extension === 'markdown' ||
    ALLOWED_TEXT_MIME_TYPES.includes(
      file.type as (typeof ALLOWED_TEXT_MIME_TYPES)[number],
    )
  );
}

/**
 * ファイルが許可された画像形式であるかを判定する。
 *
 * @param file - 判定対象ファイル。
 * @returns 許可された画像ファイルの場合はtrue。
 */
function isSupportedImage(file: File): boolean {
  if (
    ALLOWED_IMAGE_MIME_TYPES.includes(
      file.type as (typeof ALLOWED_IMAGE_MIME_TYPES)[number],
    )
  ) {
    return true;
  }
  const extension = file.name.toLowerCase().split('.').pop();
  const validExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
  return extension ? validExtensions.includes(extension) : false;
}

/** WebKit/Blink ファイルシステムエントリの型定義。 */
interface WebkitEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
}

interface WebkitFileEntry extends WebkitEntry {
  file: (success: (file: File) => void, error?: (err: unknown) => void) => void;
}

interface WebkitDirectoryReader {
  readEntries: (
    success: (entries: WebkitEntry[]) => void,
    error?: (err: unknown) => void,
  ) => void;
}

interface WebkitDirectoryEntry extends WebkitEntry {
  createReader: () => WebkitDirectoryReader;
}

/**
 * FileSystemEntry を再帰的に走査して VirtualFile リストを抽出する。
 *
 * @param entry - FileSystemEntry または null。
 * @param basePath - 現在の相対パス階層。
 * @returns 仮想ファイルリストのPromise。
 */
async function scanEntry(
  entry: WebkitEntry | null,
  basePath = '',
): Promise<Array<{ file: File; relativePath: string }>> {
  if (!entry) {
    return [];
  }

  if (entry.isFile) {
    const fileEntry = entry as WebkitFileEntry;
    return new Promise((resolve) => {
      fileEntry.file(
        (file: File) => {
          const relativePath = basePath
            ? `${basePath}/${file.name}`
            : file.name;
          resolve([{ file, relativePath }]);
        },
        () => resolve([]),
      );
    });
  }

  if (entry.isDirectory) {
    const dirEntry = entry as WebkitDirectoryEntry;
    const dirReader = dirEntry.createReader();
    const currentPath = basePath ? `${basePath}/${entry.name}` : entry.name;
    const entries: WebkitEntry[] = [];

    const readBatch = (): Promise<WebkitEntry[]> =>
      new Promise((resolve) => {
        dirReader.readEntries(
          (batch: WebkitEntry[]) => {
            if (batch.length === 0) {
              resolve(entries);
            } else {
              entries.push(...batch);
              resolve(readBatch());
            }
          },
          () => resolve(entries),
        );
      });

    const allEntries = await readBatch();
    const nestedFiles = await Promise.all(
      allEntries.map((childEntry) => scanEntry(childEntry, currentPath)),
    );
    return nestedFiles.flat();
  }

  return [];
}

/**
 * D&Dおよびファイル選択のイベント処理と状態管理を行うカスタムフック。
 *
 * @returns ドロップゾーン操作用ハンドラーおよび分類済みファイル群。
 */
export function useFileDrop() {
  const [status, setStatus] = useState<DropZoneStatus>('idle');
  const [parsedFiles, setParsedFiles] = useState<ParsedFiles>({
    markdownFile: null,
    assetFiles: new Map(),
    totalSize: 0,
    isTotalSizeExceeded: false,
    hasInvalidFiles: false,
  });

  const dragCounterRef = useRef<number>(0);

  /** 抽出された生ファイル群をパース・分類する。 */
  const processRawFiles = useCallback(
    (rawFiles: Array<{ file: File; relativePath: string }>) => {
      if (rawFiles.length === 0) {
        return;
      }

      let primaryMarkdown: VirtualFile | null = null;
      const assetMap = new Map<string, VirtualFile>();
      let totalBytes = 0;
      let hasError = false;

      for (const item of rawFiles) {
        const { file, relativePath } = item;
        totalBytes += file.size;

        const isSizeOver = file.size > MAX_SINGLE_FILE_SIZE;
        const isMd = isMarkdownFile(file);
        const isImg = isSupportedImage(file);
        const isTypeUnsupported = !isMd && !isImg;

        if (isSizeOver || isTypeUnsupported) {
          hasError = true;
        }

        const virtualFile: VirtualFile = {
          file,
          relativePath,
          isSizeExceeded: isSizeOver,
          isTypeUnsupported,
        };

        if (isMd && !primaryMarkdown) {
          primaryMarkdown = virtualFile;
        } else {
          assetMap.set(relativePath, virtualFile);
        }
      }

      const isTotalOver = totalBytes > MAX_TOTAL_FILE_SIZE;
      if (isTotalOver) {
        hasError = true;
      }

      setParsedFiles({
        markdownFile: primaryMarkdown,
        assetFiles: assetMap,
        totalSize: totalBytes,
        isTotalSizeExceeded: isTotalOver,
        hasInvalidFiles: hasError,
      });

      setStatus('ready');
    },
    [],
  );

  /** ウィンドウ全体での誤ドロップによるページ離脱を防止する。 */
  useEffect(() => {
    const handleGlobalDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleGlobalDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener('dragover', handleGlobalDragOver, false);
    window.addEventListener('drop', handleGlobalDrop, false);

    return () => {
      window.removeEventListener('dragover', handleGlobalDragOver, false);
      window.removeEventListener('drop', handleGlobalDrop, false);
    };
  }, []);

  /** ドロップゾーンへのドラッグ侵入ハンドラー。 */
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (dragCounterRef.current === 1) {
      setStatus('dragover');
    }
  }, []);

  /** ドロップゾーンからのドラッグ退出ハンドラー。 */
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) {
      setStatus((prev) => (prev === 'dragover' ? 'idle' : prev));
    }
  }, []);

  /** ドロップゾーン上でのドラッグオーバーハンドラー。 */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  /** ドロップゾーンへのドロップハンドラー。 */
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;

      const items = e.dataTransfer.items;
      if (items && items.length > 0) {
        const scanPromises: Promise<
          Array<{ file: File; relativePath: string }>
        >[] = [];

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const entry =
            typeof item.webkitGetAsEntry === 'function'
              ? (item.webkitGetAsEntry() as unknown as WebkitEntry)
              : null;

          if (entry) {
            scanPromises.push(scanEntry(entry));
          } else {
            const file = item.getAsFile();
            if (file) {
              scanPromises.push(
                Promise.resolve([{ file, relativePath: file.name }]),
              );
            }
          }
        }

        const results = await Promise.all(scanPromises);
        processRawFiles(results.flat());
        return;
      }

      // itemsが利用できないフォールバック処理。
      const files = Array.from(e.dataTransfer.files).map((file) => ({
        file,
        relativePath: file.name,
      }));
      processRawFiles(files);
    },
    [processRawFiles],
  );

  /** 通常のファイル選択インプットからの変更ハンドラー。 */
  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) {
        return;
      }

      const fileList = Array.from(files).map((file) => {
        // webkitRelativePath が存在する場合は相対パスを利用する。
        const relativePath = file.webkitRelativePath || file.name;
        return { file, relativePath };
      });

      processRawFiles(fileList);
      // 同じファイルを再選択できるようにリセットする。
      e.target.value = '';
    },
    [processRawFiles],
  );

  /** 選択状態をリセットする。 */
  const resetFiles = useCallback(() => {
    setParsedFiles({
      markdownFile: null,
      assetFiles: new Map(),
      totalSize: 0,
      isTotalSizeExceeded: false,
      hasInvalidFiles: false,
    });
    setStatus('idle');
  }, []);

  return {
    status,
    parsedFiles,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleFileInputChange,
    resetFiles,
  };
}
