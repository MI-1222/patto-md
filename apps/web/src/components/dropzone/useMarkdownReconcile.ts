import { useState, useEffect, useRef } from 'react';
import type { ParsedFiles } from './types';
import {
  parseMarkdown,
  reconcileAssets,
  replaceMarkdownImageUrls,
  type MarkdownParseResult,
  type ReconciliationResult,
} from '../../lib/markdown';

/**
 * Markdown解析および仮想ファイルマップ突合の統合フック戻り値の型定義。
 */
export interface UseMarkdownReconcileReturn {
  /** Markdown解析結果(未解析またはパース失敗時は `null`)。 */
  parseResult: MarkdownParseResult | null;
  /** 原本Markdownテキスト文字列。 */
  markdownContent: string;
  /** 突合判定結果(未実行時は `null`)。 */
  reconciliation: ReconciliationResult | null;
  /** `cleanPath` から `blob: URL` へのマッピングテーブル。 */
  previewUrlMap: Map<string, string>;
  /** プレビュー用URLが注入されたMarkdown文字列。 */
  previewMarkdown: string;
  /** パースおよび突合処理中かどうかの真偽値。 */
  isResolving: boolean;
  /** すべての参照画像が過不足なく解決されたかどうかの真偽値。 */
  isReadyToPublish: boolean;
}

/**
 * ドロップされたMarkdownファイルとアセットファイル群を自動突合し、
 * プレビュー用URLのライフサイクルを安全に管理するカスタムフック。
 *
 * @param parsedFiles - 分類済みファイル群(Markdownおよび添付アセット)。
 * @returns 突合状態およびプレビュー用データ。
 */
export function useMarkdownReconcile(
  parsedFiles: ParsedFiles,
): UseMarkdownReconcileReturn {
  const { markdownFile, assetFiles } = parsedFiles;

  const [parseResult, setParseResult] = useState<MarkdownParseResult | null>(
    null,
  );
  const [markdownContent, setMarkdownContent] = useState<string>('');
  const [reconciliation, setReconciliation] =
    useState<ReconciliationResult | null>(null);
  const [previewUrlMap, setPreviewUrlMap] = useState<Map<string, string>>(
    new Map(),
  );
  const [previewMarkdown, setPreviewMarkdown] = useState<string>('');
  const [isResolving, setIsResolving] = useState<boolean>(false);

  // 発行済みのBlob URLを追跡・解放するためのRef。
  const activeBlobUrlsRef = useRef<Set<string>>(new Set());
  // `File` オブジェクトから発行済みBlob URLへのキャッシュRef(チラつき防止と再利用)。
  const fileToUrlCacheRef = useRef<Map<File, string>>(new Map());

  // コンポーネントアンマウント時に全Blob URLを確実に解放する。
  useEffect(() => {
    return () => {
      for (const url of activeBlobUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      activeBlobUrlsRef.current.clear();
      fileToUrlCacheRef.current.clear();
    };
  }, []);

  // Markdownファイルまたは添付アセットが変化した際に突合処理を実行する。
  useEffect(() => {
    let isCancelled = false;

    if (!markdownFile) {
      setParseResult(null);
      setMarkdownContent('');
      setReconciliation(null);
      setPreviewUrlMap(new Map());
      setPreviewMarkdown('');

      // 発行済みの全Blob URLを解放する。
      for (const url of activeBlobUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      activeBlobUrlsRef.current.clear();
      fileToUrlCacheRef.current.clear();
      return;
    }

    const runReconciliation = async () => {
      setIsResolving(true);
      try {
        const text = await markdownFile.file.text();
        if (isCancelled) {
          return;
        }

        const parsed = await parseMarkdown(text, {
          basePath: markdownFile.relativePath,
          fallbackTitle: markdownFile.file.name.replace(/\.[^/.]+$/, ''),
        });
        if (isCancelled) {
          return;
        }

        // 仮想ファイルマップとの突合処理。
        const recon = reconcileAssets(parsed.imageRefs, assetFiles);
        if (isCancelled) {
          return;
        }

        // 一時Object URLの生成と差分更新(既存キャッシュを再利用してチラつきを防止)。
        const nextUrlMap = new Map<string, string>();
        const nextActiveUrls = new Set<string>();

        for (const [cleanPath, resolvedAsset] of recon.resolved.entries()) {
          let blobUrl = fileToUrlCacheRef.current.get(resolvedAsset.file);
          if (!blobUrl) {
            blobUrl = URL.createObjectURL(resolvedAsset.file);
            fileToUrlCacheRef.current.set(resolvedAsset.file, blobUrl);
          }
          nextUrlMap.set(cleanPath, blobUrl);
          nextActiveUrls.add(blobUrl);
        }

        // 不要になった古いBlob URLを解放し、キャッシュからも除外する。
        for (const oldUrl of activeBlobUrlsRef.current) {
          if (!nextActiveUrls.has(oldUrl)) {
            URL.revokeObjectURL(oldUrl);
            for (const [
              file,
              cachedUrl,
            ] of fileToUrlCacheRef.current.entries()) {
              if (cachedUrl === oldUrl) {
                fileToUrlCacheRef.current.delete(file);
                break;
              }
            }
          }
        }
        activeBlobUrlsRef.current = nextActiveUrls;

        // プレビュー用置換Markdownテキストの生成。
        const replacedMd = replaceMarkdownImageUrls(
          text,
          parsed.imageRefs,
          nextUrlMap,
        );

        setMarkdownContent(text);
        setParseResult(parsed);
        setReconciliation(recon);
        setPreviewUrlMap(nextUrlMap);
        setPreviewMarkdown(replacedMd);
      } catch (_err) {
        // パースエラーなどの異常系処理。
        if (!isCancelled) {
          setReconciliation(null);
        }
      } finally {
        if (!isCancelled) {
          setIsResolving(false);
        }
      }
    };

    runReconciliation();

    return () => {
      isCancelled = true;
    };
  }, [markdownFile, assetFiles]);

  const isReadyToPublish =
    markdownFile !== null &&
    !parsedFiles.hasInvalidFiles &&
    reconciliation !== null &&
    reconciliation.isComplete;

  return {
    parseResult,
    markdownContent,
    reconciliation,
    previewUrlMap,
    previewMarkdown,
    isResolving,
    isReadyToPublish,
  };
}
