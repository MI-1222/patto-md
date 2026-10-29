import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  DocumentCommitResponse,
  ExpirationPreset,
} from '@patto-md/shared';
import {
  executePublishPipeline,
  type PublishProgressInfo,
} from '../../lib/api/publish';
import { ApiError } from '../../lib/api/client';
import type {
  MarkdownParseResult,
  ReconciliationResult,
} from '../../lib/markdown';
import type { ParsedFiles } from './types';

/**
 * アップロードおよびコミット処理の進行状態。
 */
export type PublishStatus =
  'idle' | 'signing' | 'uploading' | 'committing' | 'completed' | 'error';

/**
 * ドキュメント公開処理のパラメータ定義。
 */
export interface PublishParams {
  /** ドロップおよび分類済みのファイル群。 */
  parsedFiles: ParsedFiles;
  /** 仮想ファイルマップの突合結果。 */
  reconciliation: ReconciliationResult | null;
  /** Markdown解析結果。 */
  parseResult: MarkdownParseResult | null;
  /** 原本となるMarkdownテキスト文字列。 */
  markdownContent: string;
  /** 選択された有効期限プリセット。 */
  expiration: ExpirationPreset;
  /** 未解決画像のリンク切れ公開を容認するかどうかの真偽値。 */
  allowIncompletePublish?: boolean;
  /** 公開成功時のコールバック関数。指定時は自動遷移を行わずに呼び出す。 */
  onSuccess?: (response: DocumentCommitResponse) => void;
}

/**
 * `useDocumentPublish` フックの戻り値の型定義。
 */
export interface UseDocumentPublishReturn {
  /** 現在の進行状態。 */
  status: PublishStatus;
  /** ユーザー向けの進捗メッセージ。 */
  progressMessage: string;
  /** 進捗割合 (0〜100)。 */
  progressPercent: number;
  /** エラー発生時のメッセージ。 */
  errorMessage: string | null;
  /** 公開処理が実行中であるかを示す真偽値。 */
  isPublishing: boolean;
  /** 発行されたパーマリンクURL。 */
  publishedUrl: string | null;
  /** 公開パイプラインを実行するハンドラー関数。 */
  publish: (params: PublishParams) => Promise<DocumentCommitResponse | null>;
  /** 状態をクリアしてアイドル状態へ戻すリセット関数。 */
  resetPublishState: () => void;
}

/**
 * Direct Uploadおよびドキュメントのコミット処理を統合管理するカスタムフック。
 *
 * @returns 公開状態および制御関数群。
 */
export function useDocumentPublish(): UseDocumentPublishReturn {
  const [status, setStatus] = useState<PublishStatus>('idle');
  const [progressMessage, setProgressMessage] = useState<string>('');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);

  const isPublishing =
    status === 'signing' || status === 'uploading' || status === 'committing';

  const isPublishingRef = useRef(isPublishing);
  isPublishingRef.current = isPublishing;

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isPublishingRef.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', handleBeforeUnload);
      return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
      };
    }
  }, []);

  const resetPublishState = useCallback(() => {
    setStatus('idle');
    setProgressMessage('');
    setProgressPercent(0);
    setErrorMessage(null);
    setPublishedUrl(null);
  }, []);

  const publish = useCallback(
    async (params: PublishParams): Promise<DocumentCommitResponse | null> => {
      const { onSuccess } = params;

      setErrorMessage(null);
      setStatus('signing');
      setProgressPercent(10);
      setProgressMessage('署名を発行中...');

      try {
        const commitResponse = await executePublishPipeline({
          ...params,
          onProgress: (progress: PublishProgressInfo) => {
            setStatus(progress.stage);
            setProgressPercent(progress.percent);
            setProgressMessage(progress.message);
          },
        });

        // 公開成功確定後は離脱防止アラートを即座に解除する。
        isPublishingRef.current = false;
        setStatus('completed');
        setProgressPercent(100);
        setProgressMessage('ドキュメントの公開に成功。');
        setPublishedUrl(commitResponse.url);

        if (onSuccess) {
          onSuccess(commitResponse);
        } else if (typeof window !== 'undefined') {
          window.location.href = commitResponse.url;
        }

        return commitResponse;
      } catch (error) {
        console.error('ドキュメント公開エラー:', error);
        const message =
          error instanceof ApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : '予期せぬエラーが発生しました。';

        setErrorMessage(message);
        setStatus('error');
        return null;
      }
    },
    [],
  );

  return {
    status,
    progressMessage,
    progressPercent,
    errorMessage,
    isPublishing,
    publishedUrl,
    publish,
    resetPublishState,
  };
}
