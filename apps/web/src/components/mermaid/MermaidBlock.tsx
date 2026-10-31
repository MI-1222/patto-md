import React, { useState, useEffect, type FC } from 'react';
import {
  renderMermaidToSvg,
  openMermaidModal,
} from '../../lib/mermaid/renderer';

/** `MermaidBlock` コンポーネントのプロパティ定義。 */
export interface MermaidBlockProps {
  /** 描画対象のMermaidコード文字列。 */
  code: string;
}

/**
 * Reactコンテキスト内でMermaidダイアグラムを動的に描画するコンポーネント。
 *
 * `MarkdownPreview` 等のASTベースプレビューにおいて、クライアントサイドでSVGを描画し、
 * テーマ連動、構文エラー時のフォールバック、拡大モーダル、および生コードコピートグル機能を提供する。
 */
export const MermaidBlock: FC<MermaidBlockProps> = ({ code }) => {
  /** レンダリング済みのインラインSVG文字列。 */
  const [svg, setSvg] = useState<string | null>(null);
  /** レンダリング失敗時のエラーメッセージ。 */
  const [error, setError] = useState<string | null>(null);
  /** 原本コードの表示トグル状態。 */
  const [isShowingCode, setIsShowingCode] = useState<boolean>(false);
  /** コピー完了フィードバックの表示状態。 */
  const [copied, setCopied] = useState<boolean>(false);

  /** 前後の空白を除去したMermaidコード文字列。 */
  const trimmedCode = code.trim();

  useEffect(() => {
    let isMounted = true;

    /** MermaidコードをパースしてSVGを生成・状態更新する非同期処理。 */
    async function generateSvg() {
      if (!trimmedCode) {
        setSvg(null);
        setError('ダイアグラムのコードが空です。');
        return;
      }

      const result = await renderMermaidToSvg(trimmedCode);
      if (!isMounted) {
        return;
      }

      if (result.error) {
        setError(result.error);
        setSvg(null);
      } else {
        setError(null);
        setSvg(result.svg || null);
      }
    }

    void generateSvg();

    return () => {
      isMounted = false;
    };
  }, [trimmedCode]);

  /** 原本コードをクリップボードにコピーするハンドラー。 */
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(trimmedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="mermaid-block relative my-6 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950/70 backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-neutral-800/80 bg-neutral-900/60 px-4 py-2 text-xs text-neutral-400 select-none">
        <div className="flex items-center gap-2">
          {error ? (
            <span className="inline-flex items-center gap-1.5 rounded border border-rose-800/60 bg-rose-950/80 px-2 py-0.5 text-[11px] font-medium text-rose-400">
              <svg className="size-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              Mermaid構文エラー
            </span>
          ) : (
            <span className="font-mono text-[11px] font-medium tracking-wide text-neutral-400">
              Mermaid
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className={`rounded px-2 py-1 text-[11px] transition-colors hover:bg-neutral-800 ${
              copied
                ? 'font-medium text-emerald-400'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {copied ? 'コピー完了' : 'コピー'}
          </button>

          {!error && svg && (
            <>
              <button
                type="button"
                onClick={() => setIsShowingCode(!isShowingCode)}
                className="rounded px-2 py-1 text-[11px] text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
              >
                {isShowingCode ? '図を表示' : 'コード'}
              </button>
              <button
                type="button"
                onClick={() => openMermaidModal(svg)}
                className="rounded px-2 py-1 text-[11px] text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
              >
                拡大
              </button>
            </>
          )}
        </div>
      </div>

      {error ? (
        <div>
          <div className="border-b border-rose-900/40 bg-rose-950/20 px-4 py-2 font-mono text-xs text-rose-300">
            {error}
          </div>
          <div className="overflow-x-auto bg-neutral-950/80 p-4">
            <pre className="font-mono text-xs text-neutral-300">
              <code>{trimmedCode}</code>
            </pre>
          </div>
        </div>
      ) : isShowingCode ? (
        <div className="overflow-x-auto bg-neutral-950/80 p-4">
          <pre className="font-mono text-xs text-neutral-300">
            <code>{trimmedCode}</code>
          </pre>
        </div>
      ) : svg ? (
        <div
          className="mermaid-rendered flex min-h-18 items-center justify-center overflow-x-auto p-5 [&>svg]:h-auto [&>svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="flex min-h-18 items-center justify-center p-5 text-xs text-neutral-500">
          ダイアグラムを描画中...
        </div>
      )}
    </div>
  );
};
