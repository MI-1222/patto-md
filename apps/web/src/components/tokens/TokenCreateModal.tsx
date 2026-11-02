import React, { useState, useEffect } from 'react';
import {
  MAX_PAT_NAME_LENGTH,
  MIN_PAT_NAME_LENGTH,
  TOKEN_SCOPES,
  type CreatePatRequest,
  type TokenExpirationPreset,
  type TokenScope,
} from '@patto-md/shared';

/** トークン新規発行モーダルの `props` 定義。 */
export interface TokenCreateModalProps {
  /** モーダルが開いているかどうかのフラグ。 */
  isOpen: boolean;
  /** モーダルを閉じる際のハンドラー。 */
  onClose: () => void;
  /** トークン作成要求実行ハンドラー。 */
  onCreateToken: (payload: CreatePatRequest) => Promise<void>;
}

/** 各スコープのユーザー向け説明定義。 */
const SCOPE_DESCRIPTIONS: Record<
  TokenScope,
  { label: string; description: string }
> = {
  'documents:read': {
    label: 'documents:read',
    description: '所有ドキュメントの一覧取得および本文の読み取り。',
  },
  'documents:write': {
    label: 'documents:write',
    description: '新規ドキュメント作成・本文更新・画像アップロード。',
  },
  'documents:delete': {
    label: 'documents:delete',
    description: '所有ドキュメントの完全削除。',
  },
};

/** 有効期限プリセットの選択肢定義。 */
const EXPIRATION_OPTIONS: { value: TokenExpirationPreset; label: string }[] = [
  { value: '30days', label: '30日間 (推奨)' },
  { value: '90days', label: '90日間' },
  { value: '1year', label: '1年間' },
  { value: 'never', label: '無期限' },
];

/** パーソナルアクセストークン(PAT)新規発行モーダルコンポーネント。 */
export const TokenCreateModal: React.FC<TokenCreateModalProps> = ({
  isOpen,
  onClose,
  onCreateToken,
}) => {
  const [name, setName] = useState<string>('');
  const [selectedScopes, setSelectedScopes] = useState<TokenScope[]>([
    'documents:read',
    'documents:write',
  ]);
  const [expiration, setExpiration] = useState<TokenExpirationPreset>('30days');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /** フォーム入力状態およびエラーメッセージを初期値にリセットする。 */
  const resetForm = () => {
    setName('');
    setSelectedScopes(['documents:read', 'documents:write']);
    setExpiration('30days');
    setErrorMessage(null);
  };

  useEffect(() => {
    if (!isOpen) {
      resetForm();
    }
  }, [isOpen]);

  /** モーダルを閉じる際のハンドラー。 */
  const handleClose = () => {
    if (isSubmitting) return;
    resetForm();
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  const trimmedName = name.trim();
  const isNameValid =
    trimmedName.length >= MIN_PAT_NAME_LENGTH &&
    trimmedName.length <= MAX_PAT_NAME_LENGTH;
  const isScopeValid = selectedScopes.length > 0;
  const canSubmit = isNameValid && isScopeValid && !isSubmitting;

  /**
   * スコープのチェック状態を切り替える。
   *
   * @param scope - 対象スコープ。
   */
  const handleScopeToggle = (scope: TokenScope) => {
    setSelectedScopes((prev) =>
      prev.includes(scope)
        ? prev.filter((item) => item !== scope)
        : [...prev, scope],
    );
  };

  /**
   * フォーム送信ハンドラー。
   *
   * トークンを発行し、成功時はフォーム状態を初期値に戻す。
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await onCreateToken({
        name: trimmedName,
        scopes: selectedScopes,
        expiration,
      });
      resetForm();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'トークンの発行に失敗しました。',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-token-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          handleClose();
        }
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
          <h2
            id="create-token-title"
            className="text-lg font-bold text-neutral-100"
          >
            新規パーソナルアクセストークン発行
          </h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="text-neutral-400 hover:text-neutral-200 disabled:opacity-50"
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-5">
          <div>
            <label
              htmlFor="token-name"
              className="block text-xs font-semibold text-neutral-300"
            >
              トークン名 <span className="text-red-400">*</span>
            </label>
            <input
              id="token-name"
              type="text"
              placeholder="例: CLI-Publish-Token, Claude-Agent-Token"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_PAT_NAME_LENGTH}
              disabled={isSubmitting}
              className="mt-1.5 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
            />
            <div className="mt-1 flex justify-between text-[11px] text-neutral-500">
              <span>用途やクライアントが分かる名前を推奨します。</span>
              <span>
                {trimmedName.length} / {MAX_PAT_NAME_LENGTH}
              </span>
            </div>
            {name.length > 0 && !isNameValid && (
              <p className="mt-1 text-[11px] text-red-400">
                トークン名は1〜{MAX_PAT_NAME_LENGTH}文字以内で入力してください。
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-neutral-300">
              付与する認可スコープ <span className="text-red-400">*</span>
            </label>
            <p className="mt-0.5 text-[11px] text-neutral-500">
              セキュリティ向上のため、必要な最小限の権限を選択してください。
            </p>

            <div className="mt-2 space-y-2">
              {TOKEN_SCOPES.map((scope) => {
                const info = SCOPE_DESCRIPTIONS[scope];
                const checked = selectedScopes.includes(scope);

                return (
                  <label
                    key={scope}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-2.5 transition-colors ${
                      checked
                        ? 'border-blue-500/40 bg-blue-500/5'
                        : 'border-neutral-800 bg-neutral-950/40 hover:border-neutral-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => handleScopeToggle(scope)}
                      disabled={isSubmitting}
                      className="mt-0.5 rounded border-neutral-700 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="space-y-0.5">
                      <div className="font-mono text-xs font-semibold text-neutral-200">
                        {info.label}
                      </div>
                      <div className="text-[11px] text-neutral-400">
                        {info.description}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            {!isScopeValid && (
              <p className="mt-1.5 text-[11px] text-red-400">
                少なくとも1つのスコープを選択してください。
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="token-expiration"
              className="block text-xs font-semibold text-neutral-300"
            >
              有効期限
            </label>
            <select
              id="token-expiration"
              value={expiration}
              onChange={(e) =>
                setExpiration(e.target.value as TokenExpirationPreset)
              }
              disabled={isSubmitting}
              className="mt-1.5 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-neutral-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
            >
              {EXPIRATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {errorMessage && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
              {errorMessage}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 border-t border-neutral-800 pt-4">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-700 disabled:opacity-50"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? '発行中...' : 'トークンを発行する'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
