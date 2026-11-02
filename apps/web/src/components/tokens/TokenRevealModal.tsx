import React, { useState } from 'react';
import type { CreatePatResponse } from '@patto-md/shared';
import { CheckIcon, CopyIcon } from '../svg/ActionIcons';

/** ワンタイム平文トークン表示モーダルの `props` 定義。 */
export interface TokenRevealModalProps {
  /** 発行されたトークン情報(平文トークンを含む)。 */
  token: CreatePatResponse;
  /** モーダルを閉じ、平文Stateを破棄するハンドラー。 */
  onClose: () => void;
}

/**
 * 新規発行成功時に1度だけ平文トークンを表示するモーダルコンポーネント。
 *
 * 誤操作による消失を防ぐため、背景クリックおよびEscキーによるクローズは遮断し、
 * 明示的な「トークンを保存しました(閉じる)」ボタンでのみ閉じる設計とする。
 */
export const TokenRevealModal: React.FC<TokenRevealModalProps> = ({
  token,
  onClose,
}) => {
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  /**
   * 平文トークンをクリップボードにコピーする。
   *
   * クリップボード API が利用できない環境では、`input` 要素を選択状態にして手動コピー案内を表示する。
   */
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(token.token);
      setIsCopied(true);
      setCopyError(null);
      setTimeout(() => setIsCopied(false), 3000);
    } catch {
      const inputEl = document.getElementById(
        'revealed-token-input',
      ) as HTMLInputElement | null;
      inputEl?.select();
      setCopyError(
        'コピーに失敗しました。選択された文字列を手動でコピーしてください。',
      );
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reveal-token-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg rounded-2xl border border-neutral-700 bg-neutral-900 p-6 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-neutral-800 pb-4">
          <div className="rounded-full bg-emerald-500/10 p-2 text-emerald-400">
            <CheckIcon className="size-5" />
          </div>
          <div>
            <h2
              id="reveal-token-title"
              className="text-base font-bold text-neutral-100"
            >
              パーソナルアクセストークンを発行しました
            </h2>
            <p className="text-xs text-neutral-400">
              トークン名:{' '}
              <span className="font-semibold text-neutral-200">
                {token.name}
              </span>
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-200">
          <div className="flex items-start gap-2.5">
            <span className="text-base leading-none">⚠️</span>
            <div className="space-y-1">
              <strong className="font-semibold text-amber-100">
                このトークンは二度と表示されません。
              </strong>
              <p className="text-[11px] leading-relaxed text-amber-200/90">
                セキュリティ保護のため、データベースには暗号ハッシュのみが保存されています。
                この画面を閉じると平文トークンを再確認することはできません。今すぐコピーして安全な場所(CLI設定ファイルや環境変数)に保管してください。
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <label
            htmlFor="revealed-token-input"
            className="block text-xs font-semibold text-neutral-300"
          >
            平文トークン
          </label>
          <div className="relative">
            <input
              id="revealed-token-input"
              type="text"
              readOnly
              autoComplete="off"
              spellCheck={false}
              value={token.token}
              onClick={(e) => (e.target as HTMLInputElement).select()}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 py-2.5 pr-28 pl-3 font-mono text-xs text-emerald-400 select-all focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleCopy}
              className={`absolute top-1.5 right-1.5 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold shadow-sm transition-all ${
                isCopied
                  ? 'bg-emerald-600 text-white'
                  : 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700'
              }`}
            >
              {isCopied ? (
                <>
                  <CheckIcon className="size-3.5" />
                  <span>コピー完了</span>
                </>
              ) : (
                <>
                  <CopyIcon className="size-3.5" />
                  <span>コピー</span>
                </>
              )}
            </button>
          </div>
          {copyError && (
            <p className="mt-1 text-[11px] text-amber-400">{copyError}</p>
          )}
        </div>

        <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3 text-xs text-neutral-400">
          <div className="flex justify-between">
            <span>付与スコープ:</span>
            <span className="font-mono text-neutral-200">
              {token.scopes.join(', ')}
            </span>
          </div>
          <div className="mt-1 flex justify-between">
            <span>有効期限:</span>
            <span className="text-neutral-200">
              {token.expiresAt
                ? new Date(token.expiresAt).toLocaleDateString()
                : '無期限'}
            </span>
          </div>
        </div>

        <div className="mt-6 flex justify-end border-t border-neutral-800 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 focus:ring-2 focus:ring-blue-400 focus:outline-none"
          >
            トークンを保存しました(閉じる)
          </button>
        </div>
      </div>
    </div>
  );
};
