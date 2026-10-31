import {
  TURNSTILE_SITEVERIFY_URL,
  TURNSTILE_TEST_SECRET_KEY_BLOCK,
  TURNSTILE_TEST_SECRET_KEY_PASS,
  TURNSTILE_TEST_SITE_KEY_BLOCK,
  TURNSTILE_TEST_SITE_KEY_PASS,
  TURNSTILE_TOKEN_HEADER,
} from '@patto-md/shared/constants/turnstile';
import type { MiddlewareHandler } from 'hono';

export {
  TURNSTILE_SITEVERIFY_URL,
  TURNSTILE_TEST_SECRET_KEY_BLOCK,
  TURNSTILE_TEST_SECRET_KEY_PASS,
  TURNSTILE_TEST_SITE_KEY_BLOCK,
  TURNSTILE_TEST_SITE_KEY_PASS,
  TURNSTILE_TOKEN_HEADER,
};

/** Turnstile Siteverify API のレスポンス型定義。 */
export interface TurnstileVerifyResponse {
  /** 検証が成功したかどうかの真偽値。 */
  success: boolean;
  /** チャレンジが完了したタイムスタンプ(ISO 8601形式)。 */
  challenge_ts?: string;
  /** チャレンジが実行されたホスト名。 */
  hostname?: string;
  /** エラーコード配列。 */
  'error-codes'?: string[];
  /** チャレンジに設定されたアクション名。 */
  action?: string;
  /** チャレンジに設定されたカスタムデータ。 */
  cdata?: string;
}

/** Turnstile トークン検証結果の型定義。 */
export interface TurnstileVerifyResult {
  /** 検証が成功したかどうかの真偽値。 */
  success: boolean;
  /** エラーコード配列。 */
  errorCodes?: string[];
  /** チャレンジが実行されたホスト名。 */
  hostname?: string;
}

/** Turnstile ボット検証ミドルウェアのオプション設定。 */
export interface TurnstileMiddlewareOptions {
  /**
   * トークンの提供を必須とするかどうか。
   * 既定値は `true`。`false` の場合、ヘッダーにトークンが存在するときのみ検証を行う。
   */
  required?: boolean;
}

/** Turnstile ミドルウェアが必要とする環境バインディングの最小インターフェース。 */
export interface TurnstileBindings {
  /** Cloudflare Turnstile シークレットキー。 */
  TURNSTILE_SECRET_KEY?: string;
  [key: string]: unknown;
}

/**
 * 指定された IP アドレスがローカルまたはプライベート IP であるかを判定する。
 * Turnstile API はローカル IP を渡すと不正な IP としてエラーを返す場合があるため、送信除外の判定に用いる。
 *
 * @param ip - 判定対象の IP アドレス文字列。
 * @returns ローカルまたはプライベート IP の場合は `true`、それ以外は `false`。
 */
export function isLocalOrPrivateIp(ip: string): boolean {
  const normalized = ip.trim().toLowerCase();
  if (
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === 'localhost'
  ) {
    return true;
  }
  if (
    normalized.startsWith('10.') ||
    normalized.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)
  ) {
    return true;
  }
  return false;
}

/**
 * Turnstile Siteverify API を呼び出してトークンを検証する。
 *
 * @param params - 検証パラメータ。
 * @param params.secretKey - Turnstile シークレットキー。
 * @param params.token - クライアントから送信されたレスポンストークン。
 * @param params.remoteIp - クライアントの IP アドレス。
 * @param params.customFetch - テストまたはモック用の `fetch` 関数。
 * @returns 検証結果オブジェクト。
 */
export async function verifyTurnstileToken(params: {
  secretKey: string;
  token: string;
  remoteIp?: string | null;
  customFetch?: typeof fetch;
}): Promise<TurnstileVerifyResult> {
  const { secretKey, token, remoteIp, customFetch = fetch } = params;

  if (!secretKey || secretKey.trim().length === 0) {
    console.error('Turnstile シークレットキーが設定されていません。');
    return {
      success: false,
      errorCodes: ['missing-secret-key'],
    };
  }

  if (!token || token.trim().length === 0) {
    return {
      success: false,
      errorCodes: ['missing-input-response'],
    };
  }

  if (
    secretKey === TURNSTILE_TEST_SECRET_KEY_BLOCK ||
    token === TURNSTILE_TEST_SITE_KEY_BLOCK
  ) {
    return {
      success: false,
      errorCodes: ['invalid-input-response'],
    };
  }

  if (secretKey === TURNSTILE_TEST_SECRET_KEY_PASS) {
    return {
      success: true,
      hostname: 'dummy-test.patto-md.local',
    };
  }

  const formData = new FormData();
  formData.append('secret', secretKey);
  formData.append('response', token);

  if (remoteIp && !isLocalOrPrivateIp(remoteIp)) {
    formData.append('remoteip', remoteIp);
  }

  try {
    const response = await customFetch(TURNSTILE_SITEVERIFY_URL, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.error(
        `Turnstile Siteverify API エラー(ステータス: ${response.status})。`,
      );
      return {
        success: false,
        errorCodes: [`http-status-${response.status}`],
      };
    }

    const data = (await response.json()) as TurnstileVerifyResponse;

    return {
      success: data.success === true,
      errorCodes: data['error-codes'],
      hostname: data.hostname,
    };
  } catch (error) {
    console.error('Turnstile Siteverify API 通信例外:', error);
    return {
      success: false,
      errorCodes: ['internal-verification-error'],
    };
  }
}

/**
 * Cloudflare Turnstile によるボット防御を行う Hono ミドルウェアを生成する。
 *
 * リクエストヘッダーから Turnstile トークンを抽出し、
 * Cloudflare Siteverify API と照合して正当なアクセスであるかを検証する。
 *
 * @param options - ミドルウェアの挙動オプション。
 * @returns Hono ミドルウェアハンドラー。
 */
export function createTurnstileMiddleware<
  E extends { Bindings: TurnstileBindings } = { Bindings: TurnstileBindings },
>(options: TurnstileMiddlewareOptions = {}): MiddlewareHandler<E> {
  const { required = true } = options;

  return async (c, next) => {
    const token =
      c.req.header(TURNSTILE_TOKEN_HEADER) ||
      c.req.header('cf-turnstile-response') ||
      c.req.header('x-turnstile-token');

    if (!token || token.trim().length === 0) {
      if (required) {
        return c.json(
          {
            error: {
              message: 'ボット検証トークンが指定されていません。',
            },
          },
          400,
        );
      }
      return await next();
    }

    const secretKey = c.env.TURNSTILE_SECRET_KEY;
    if (!secretKey) {
      console.error(
        'Turnstile シークレットキー未設定エラー: c.env.TURNSTILE_SECRET_KEY が存在しません。',
      );
      return c.json(
        {
          error: {
            message: 'ボット検証用シークレットキーが設定されていません。',
          },
        },
        500,
      );
    }

    const clientIp =
      c.req.header('cf-connecting-ip') ||
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim();

    const verifyResult = await verifyTurnstileToken({
      secretKey,
      token,
      remoteIp: clientIp,
    });

    if (!verifyResult.success) {
      return c.json(
        {
          error: {
            message: 'ボット検証に失敗しました。',
            details: verifyResult.errorCodes,
          },
        },
        403,
      );
    }

    return await next();
  };
}
