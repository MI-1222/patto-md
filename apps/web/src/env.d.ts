/// <reference types="astro/client" />

declare global {
  /** Astro 環境変数の型定義。 */
  interface ImportMetaEnv {
    /** API サーバーのベースURL。 */
    readonly PUBLIC_API_URL?: string;
    /** Cloudflare Turnstile サイトキー。 */
    readonly PUBLIC_TURNSTILE_SITE_KEY?: string;
  }

  /** Cloudflare Turnstile ウィジェットの描画オプション定義。 */
  interface TurnstileRenderOptions {
    /** Turnstile サイトキー。 */
    sitekey: string;
    /** チャレンジ成功時のコールバック関数。 */
    callback?: (token: string) => void;
    /** トークン有効期限切れ時のコールバック関数。 */
    'expired-callback'?: () => void;
    /** チャレンジ失敗・エラー時のコールバック関数。 */
    'error-callback'?: (error?: unknown) => void;
    /** 表示テーマ (`'light'` | `'dark'` | `'auto'`)。 */
    theme?: 'light' | 'dark' | 'auto';
    /** ウィジェットサイズ (`'normal'` | `'compact'` | `'flexible'`)。 */
    size?: 'normal' | 'compact' | 'flexible';
    /** リトライ設定 (`'auto'` | `'never'`)。 */
    retry?: 'auto' | 'never';
    /** リトライ待機間隔(ミリ秒)。 */
    'retry-interval'?: number;
    /** アクション名。 */
    action?: string;
    /** カスタムデータ。 */
    cdata?: string;
  }

  /** Cloudflare Turnstile グローバル API のインターフェース定義。 */
  interface TurnstileApi {
    /**
     * 指定したコンテナ要素に Turnstile ウィジェットを明示的に描画する。
     *
     * @param container - マウント先の DOM 要素またはセレクタ文字列。
     * @param options - ウィジェットの設定オプション。
     * @returns ウィジェットの一意な識別子文字列。
     */
    render: (
      container: HTMLElement | string,
      options: TurnstileRenderOptions,
    ) => string;

    /**
     * 指定したウィジェットのチャレンジ状態をリセットし、トークンを破棄・再取得する。
     *
     * @param widgetId - 対象ウィジェットの識別子(未指定時は最初のウィジェット)。
     */
    reset: (widgetId?: string) => void;

    /**
     * 指定したウィジェットを DOM から破棄・解放する。
     *
     * @param widgetId - 対象ウィジェットの識別子(未指定時は最初のウィジェット)。
     */
    remove: (widgetId?: string) => void;

    /**
     * 指定したウィジェットの現在の検証トークンを取得する。
     *
     * @param widgetId - 対象ウィジェットの識別子(未指定時は最初のウィジェット)。
     * @returns 検証トークン文字列(未検証時は空文字列)。
     */
    getResponse: (widgetId?: string) => string;
  }

  interface Window {
    /** Cloudflare Turnstile グローバル API インスタンス。 */
    turnstile?: TurnstileApi;
    /** サーバーサイドから注入される API ベースURL。 */
    __PATTO_API_URL__?: string;
  }
}

export {};
