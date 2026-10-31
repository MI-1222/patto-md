import { useState, useEffect, useRef, type FC, type FormEvent } from 'react';
import {
  ABUSE_REPORT_REASONS,
  ABUSE_REPORT_REASON_LABELS,
  MAX_ABUSE_REPORT_DETAILS_LENGTH,
  type AbuseReportReason,
} from '@patto-md/shared';
import { FlagIcon, CheckIcon } from '../svg/ActionIcons';
import { TurnstileWidget } from '../turnstile/TurnstileWidget';
import { reportDocument } from '../../lib/api/client';
import {
  isDocumentReported,
  addReportedDocumentId,
} from '../../lib/storage/reports';

/** `ReportModal` コンポーネントのプロパティ定義。 */
export interface ReportModalProps {
  /** 通報対象のドキュメントID(`Slug`)。 */
  documentId: string;
}

/**
 * ドキュメント規約違反通報モーダルコンポーネント。
 *
 * 閲覧画面の最下部に控えめなトリガーボタンを常設し、
 * クリック時に理由選択・Turnstileボット検証付きのモーダルを展開する。
 * 通報完了後は `localStorage` に記録して同一ブラウザからの二重送信を防止する。
 */
export const ReportModal: FC<ReportModalProps> = ({ documentId }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isReported, setIsReported] = useState(false);
  const [reason, setReason] = useState<AbuseReportReason>('spam');
  const [details, setDetails] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);

  // マウント時に当ブラウザでの通報履歴を確認する。
  useEffect(() => {
    setIsReported(isDocumentReported(documentId));
  }, [documentId]);

  // モーダル展開時の Esc キー押下ハンドリング。
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting]);

  // モーダルオープン時の状態リセット。
  const handleOpen = () => {
    if (isReported) {
      return;
    }
    setReason('spam');
    setDetails('');
    setTurnstileToken(null);
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsOpen(true);
  };

  const handleClose = () => {
    if (isSubmitting) {
      return;
    }
    setIsOpen(false);
  };

  // 通報フォーム送信処理。
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!turnstileToken) {
      setErrorMessage('ボット検証が完了していません。');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await reportDocument(
        documentId,
        {
          reason,
          details: details.trim().length > 0 ? details.trim() : undefined,
        },
        turnstileToken,
      );

      addReportedDocumentId(documentId);
      setIsReported(true);
      setSuccessMessage(response.message || '通報を受け付けました。');

      // 1.5秒後にモーダルを自動クローズ。
      setTimeout(() => {
        setIsOpen(false);
      }, 1500);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '通報の送信に失敗しました。';
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex items-center justify-center pt-2">
      {isReported ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
          <CheckIcon className="size-3.5 text-neutral-400" />
          通報を受け付けました
        </span>
      ) : (
        <button
          type="button"
          onClick={handleOpen}
          className="group inline-flex items-center gap-1.5 text-xs text-neutral-500 transition-colors hover:text-neutral-300"
          title="このドキュメントの規約違反を通報する"
        >
          <FlagIcon className="size-3.5 text-neutral-500 transition-colors group-hover:text-neutral-300" />
          規約違反を通報
        </button>
      )}

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              handleClose();
            }
          }}
        >
          <div
            ref={modalRef}
            className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between border-b border-neutral-800 pb-3">
              <div className="flex items-center gap-2">
                <FlagIcon className="size-5 text-amber-500" />
                <h2
                  id="report-modal-title"
                  className="text-base font-semibold text-neutral-100"
                >
                  ドキュメントの通報
                </h2>
              </div>
              <button
                type="button"
                onClick={handleClose}
                disabled={isSubmitting}
                className="rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-50"
                aria-label="閉じる"
              >
                ✕
              </button>
            </div>

            {successMessage ? (
              <div className="py-6 text-center">
                <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
                  <CheckIcon className="size-6" />
                </div>
                <p className="text-sm font-medium text-neutral-200">
                  {successMessage}
                </p>
                <p className="mt-1 text-xs text-neutral-400">
                  ご協力ありがとうございました。
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <p className="text-xs text-neutral-400">
                  利用規約に違反するコンテンツや不適切なドキュメントを発見された場合は通報してください。
                </p>

                <div className="space-y-2">
                  <label className="block text-xs font-medium text-neutral-300">
                    通報の理由 <span className="text-rose-400">*</span>
                  </label>
                  <div className="space-y-1.5 rounded-lg border border-neutral-800 bg-neutral-950/50 p-2.5">
                    {ABUSE_REPORT_REASONS.map((reasonKey) => (
                      <label
                        key={reasonKey}
                        className="flex cursor-pointer items-start gap-2.5 rounded p-1.5 text-xs text-neutral-200 transition-colors hover:bg-neutral-800/60"
                      >
                        <input
                          type="radio"
                          name="abuse-reason"
                          value={reasonKey}
                          checked={reason === reasonKey}
                          onChange={() => setReason(reasonKey)}
                          className="mt-0.5 text-blue-600 focus:ring-blue-500"
                        />
                        <span>{ABUSE_REPORT_REASON_LABELS[reasonKey]}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="report-details"
                    className="block text-xs font-medium text-neutral-300"
                  >
                    補足説明（任意）
                  </label>
                  <textarea
                    id="report-details"
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    maxLength={MAX_ABUSE_REPORT_DETAILS_LENGTH}
                    rows={3}
                    placeholder="具体的な該当箇所や補足情報があれば入力してください。"
                    className="mt-1.5 w-full rounded-lg border border-neutral-800 bg-neutral-950 p-2.5 text-xs text-neutral-200 placeholder-neutral-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  />
                  <div className="mt-1 text-right text-[10px] text-neutral-500">
                    {details.length} / {MAX_ABUSE_REPORT_DETAILS_LENGTH}
                  </div>
                </div>

                <div className="flex justify-center">
                  <TurnstileWidget
                    onSuccess={(token) => setTurnstileToken(token)}
                    onExpire={() => setTurnstileToken(null)}
                    theme="dark"
                    size="flexible"
                  />
                </div>

                {errorMessage && (
                  <div className="rounded border border-rose-900/50 bg-rose-950/40 p-2 text-xs text-rose-300">
                    {errorMessage}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={handleClose}
                    disabled={isSubmitting}
                    className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:bg-neutral-700 disabled:opacity-50"
                  >
                    キャンセル
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || !turnstileToken}
                    className="rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSubmitting ? '送信中...' : '通報を送信'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
