/** パスコード保護ドキュメントの閲覧ロック解除カードコンポーネント。 */

import { useState, type FC, type FormEvent } from 'react';
import { ApiError, verifyPasscode } from '../../lib/api/client';
import {
  getDocumentTokens,
  savePasscodeViewToken,
} from '../../lib/storage/tokens';
import { EyeIcon, EyeSlashIcon, KeyIcon, LockIcon } from '../svg/ActionIcons';
import { SpinnerSvg } from '../svg/FileIcons';

/** パスコード解除カードコンポーネントのプロパティ定義。 */
export interface PasscodeUnlockCardProps {
  /** ドキュメント識別子(`Slug`)。 */
  documentId: string;
  /** ドキュメントのタイトル。 */
  title: string;
}

/**
 * パスコード保護されたドキュメントの閲覧権限解除フォームを表示するコンポーネント。
 *
 * @param props - コンポーネントプロパティ。
 * @returns パスコード入力および解除UI。
 */
export const PasscodeUnlockCard: FC<PasscodeUnlockCardProps> = ({
  documentId,
  title,
}) => {
  const [passcode, setPasscode] = useState('');
  const [showPasscode, setShowPasscode] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /** ローカルストレージに保持されている特権トークン。 */
  const localTokens =
    typeof window !== 'undefined' ? getDocumentTokens(documentId) : null;
  const hasLocalTokens = Boolean(
    localTokens?.editToken || localTokens?.modifyToken,
  );

  /** パスコードを送信して照合し、成功時に閲覧トークンを保存してページを再読込する。 */
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = passcode.trim();
    if (trimmed.length === 0 || isVerifying) {
      return;
    }

    setIsVerifying(true);
    setErrorMessage(null);

    try {
      const result = await verifyPasscode(documentId, trimmed);
      if (result.token) {
        savePasscodeViewToken(documentId, result.token);
      }
      window.location.reload();
    } catch (error) {
      console.error('パスコード照合エラー:', error);
      const message =
        error instanceof ApiError
          ? error.message
          : 'パスコードの照合に失敗しました。';
      setErrorMessage(message);
      setIsVerifying(false);
    }
  };

  /** 保持している特権トークンを用いて編集・閲覧URLへ直接遷移する。 */
  const handleUsePrivilegeToken = () => {
    if (!localTokens) {
      return;
    }
    const token = localTokens.editToken || localTokens.modifyToken;
    if (token) {
      const hashKey = localTokens.editToken ? 'edit_token' : 'modify_token';
      window.location.href = `/p/${documentId}#${hashKey}=${token}`;
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
      <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6 shadow-2xl backdrop-blur-md sm:p-8">
        <div className="flex flex-col items-center text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-neutral-800 text-amber-400 shadow-inner">
            <LockIcon className="size-6" />
          </div>

          <h2 className="mt-4 text-lg font-bold text-neutral-100 sm:text-xl">
            {title}
          </h2>

          <p className="mt-2 text-xs leading-relaxed text-neutral-400">
            このドキュメントはパスコードで保護されています。閲覧するにはパスコードを入力してください。
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="passcode-input"
              className="block text-xs font-medium text-neutral-300"
            >
              パスコード
            </label>
            <div className="relative mt-1.5 flex items-center">
              <input
                id="passcode-input"
                type={showPasscode ? 'text' : 'password'}
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="パスコードを入力"
                disabled={isVerifying}
                autoFocus
                className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 py-2.5 pr-10 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowPasscode(!showPasscode)}
                className="absolute right-3 text-neutral-400 hover:text-neutral-200"
                tabIndex={-1}
              >
                {showPasscode ? (
                  <EyeSlashIcon className="size-4" />
                ) : (
                  <EyeIcon className="size-4" />
                )}
              </button>
            </div>
          </div>

          {errorMessage && (
            <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-3 text-xs text-red-300">
              {errorMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={passcode.trim().length === 0 || isVerifying}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:bg-blue-500 active:scale-98 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
          >
            {isVerifying ? (
              <>
                <SpinnerSvg className="size-4" />
                <span>照合中...</span>
              </>
            ) : (
              <span>解除して閲覧する</span>
            )}
          </button>
        </form>

        {hasLocalTokens && (
          <div className="mt-6 border-t border-neutral-800 pt-4 text-center">
            <p className="text-xs text-neutral-400">
              この端末に保存された作成者・共同編集者トークンが存在します。
            </p>
            <button
              type="button"
              onClick={handleUsePrivilegeToken}
              className="mt-2 inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 hover:underline"
            >
              <KeyIcon className="size-3.5" />
              <span>特権トークンで直接閲覧・管理する</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
