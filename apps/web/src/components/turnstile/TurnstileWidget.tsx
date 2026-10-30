import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { TURNSTILE_TEST_SITE_KEY_PASS } from '@patto-md/shared';

/** `TurnstileWidget` コンポーネントの操作ハンドル型定義。 */
export interface TurnstileWidgetHandle {
  /** ウィジェットを明示的にリセットし、トークンを再取得する。 */
  reset: () => void;
}

/** `TurnstileWidget` コンポーネントのプロパティ定義。 */
export interface TurnstileWidgetProps {
  /**
   * Turnstile サイトキー。
   * 未指定時は環境変数 `PUBLIC_TURNSTILE_SITE_KEY` または公式ダミーキーを使用する。
   */
  siteKey?: string;
  /** チャレンジ成功時のコールバック関数。 */
  onSuccess: (token: string) => void;
  /** トークン有効期限切れ時のコールバック関数。 */
  onExpire?: () => void;
  /** チャレンジ失敗・エラー時のコールバック関数。 */
  onError?: (error?: unknown) => void;
  /** 表示テーマ (`'dark'` | `'light'` | `'auto'`)。既定値は `'dark'`。 */
  theme?: 'dark' | 'light' | 'auto';
  /** ウィジェットサイズ (`'normal'` | `'compact'` | `'flexible'`)。既定値は `'flexible'`。 */
  size?: 'normal' | 'compact' | 'flexible';
  /** 追加クラス名。 */
  className?: string;
}

/**
 * Cloudflare Turnstile ボット検証ウィジェットコンポーネント。
 *
 * 公式スクリプト (`challenges.cloudflare.com`) の読み込み状態を監視し、
 * 非対話型チャレンジを実行してトークンを取得する。
 */
export const TurnstileWidget = forwardRef<
  TurnstileWidgetHandle,
  TurnstileWidgetProps
>(function TurnstileWidget(
  {
    siteKey,
    onSuccess,
    onExpire,
    onError,
    theme = 'dark',
    size = 'flexible',
    className = '',
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useImperativeHandle(ref, () => ({
    reset: () => {
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.reset(widgetIdRef.current);
        } catch (error) {
          console.warn('Turnstile ウィジェットのリセットに失敗:', error);
        }
      }
    },
  }));

  useEffect(() => {
    if (typeof window === 'undefined' || !containerRef.current) {
      return;
    }

    const resolvedSiteKey =
      siteKey ||
      import.meta.env?.PUBLIC_TURNSTILE_SITE_KEY ||
      TURNSTILE_TEST_SITE_KEY_PASS;

    let isDisposed = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    /** ウィジェットを初期化・描画する内部関数。 */
    const mountWidget = () => {
      if (isDisposed || !containerRef.current || !window.turnstile) {
        return;
      }

      if (widgetIdRef.current) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* noop */
        }
        widgetIdRef.current = null;
      }

      try {
        const id = window.turnstile.render(containerRef.current, {
          sitekey: resolvedSiteKey,
          theme,
          size,
          callback: (token: string) => {
            if (!isDisposed) {
              onSuccess(token);
            }
          },
          'expired-callback': () => {
            if (!isDisposed) {
              onExpire?.();
              if (widgetIdRef.current && window.turnstile) {
                try {
                  window.turnstile.reset(widgetIdRef.current);
                } catch {
                  /* noop */
                }
              }
            }
          },
          'error-callback': (err?: unknown) => {
            if (!isDisposed) {
              console.warn('Turnstile 検証エラー検知:', err);
              onError?.(err);
            }
          },
        });
        widgetIdRef.current = id;
      } catch (error) {
        console.error('Turnstile ウィジェットの描画に失敗:', error);
      }
    };

    if (window.turnstile) {
      mountWidget();
    } else {
      let elapsed = 0;
      pollTimer = setInterval(() => {
        elapsed += 100;
        if (window.turnstile) {
          if (pollTimer) clearInterval(pollTimer);
          mountWidget();
        } else if (elapsed > 10000) {
          if (pollTimer) clearInterval(pollTimer);
          console.warn(
            'Turnstile API スクリプトの読み込みがタイムアウトしました。',
          );
        }
      }, 100);
    }

    return () => {
      isDisposed = true;
      if (pollTimer) {
        clearInterval(pollTimer);
      }
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* noop */
        }
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, onSuccess, onExpire, onError, theme, size]);

  return (
    <div
      ref={containerRef}
      className={`flex min-h-16.25 items-center justify-center ${className}`}
    />
  );
});
