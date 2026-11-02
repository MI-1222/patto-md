import type {
  AuthMeResponse,
  AuthUser,
  DocumentCommitRequest,
  DocumentCommitResponse,
  ExpirationPreset,
  UploadSignFileItem,
  UploadSignResponse,
} from '@patto-md/shared';
import { readConfigFile } from './config.ts';

/**
 * 接続先 API ベースURLを解決する。
 *
 * 優先順位:
 * 1. CLIコマンドライン引数 (`--api-url`)
 * 2. 環境変数 (`PATTO_API_URL`)
 * 3. 設定ファイル (`apiUrl`)
 * 4. 既定値 (`http://localhost:8787`)
 *
 * @param cliApiUrl - コマンドライン引数から渡されたAPI URL。
 * @param customConfigPath - テスト用等の明示的な設定ファイルパス。
 * @returns 解決された正規化済み API ベースURL。
 */
export async function resolveApiUrl(
  cliApiUrl?: string,
  customConfigPath?: string,
): Promise<string> {
  if (cliApiUrl && cliApiUrl.trim().length > 0) {
    return cliApiUrl.trim().replace(/\/+$/, '');
  }

  if (
    process.env.PATTO_API_URL &&
    process.env.PATTO_API_URL.trim().length > 0
  ) {
    return process.env.PATTO_API_URL.trim().replace(/\/+$/, '');
  }

  const config = await readConfigFile(customConfigPath);
  if (config.apiUrl && config.apiUrl.trim().length > 0) {
    return config.apiUrl.trim().replace(/\/+$/, '');
  }

  return 'http://localhost:8787';
}

/**
 * 閲覧用フロントエンドベースURLを解決する。
 *
 * 優先順位:
 * 1. CLIコマンドライン引数 (`--frontend-url`)
 * 2. 環境変数 (`PATTO_FRONTEND_URL`)
 * 3. 設定ファイル (`frontendUrl`)
 * 4. API URLがローカルホストの場合は`http://localhost:4321`、`workers.dev`の場合はサブドメインから推測、それ以外はAPI URL
 *
 * @param cliFrontendUrl - コマンドライン引数から渡されたフロントエンドURL。
 * @param apiUrl - 解決済みのAPIベースURL。
 * @param customConfigPath - テスト用等の明示的な設定ファイルパス。
 * @returns 解決された正規化済みフロントエンドベースURL。
 */
export async function resolveFrontendUrl(
  cliFrontendUrl?: string,
  apiUrl: string = 'http://localhost:8787',
  customConfigPath?: string,
): Promise<string> {
  if (cliFrontendUrl && cliFrontendUrl.trim().length > 0) {
    return cliFrontendUrl.trim().replace(/\/+$/, '');
  }

  if (
    process.env.PATTO_FRONTEND_URL &&
    process.env.PATTO_FRONTEND_URL.trim().length > 0
  ) {
    return process.env.PATTO_FRONTEND_URL.trim().replace(/\/+$/, '');
  }

  const config = await readConfigFile(customConfigPath);
  if (config.frontendUrl && config.frontendUrl.trim().length > 0) {
    return config.frontendUrl.trim().replace(/\/+$/, '');
  }

  if (apiUrl.includes('localhost') || apiUrl.includes('127.0.0.1')) {
    return 'http://localhost:4321';
  }

  if (apiUrl.includes('.workers.dev')) {
    return apiUrl.replace('patto-md-api.', 'patto-md-web.');
  }
  return apiUrl;
}

/** API通信エラーを表現するカスタムエラークラス。 */
export class CliApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'CliApiError';
  }
}

/**
 * R2 直接アップロード用 Presigned PUT URL の署名発行を要求する。
 *
 * @param files - アップロード対象のファイルメタデータ一覧。
 * @param expiration - 有効期限プリセット。
 * @param pat - パーソナルアクセストークン。
 * @param apiUrl - APIベースURL。
 * @returns 署名発行レスポンス。
 */
export async function requestUploadSign(
  files: UploadSignFileItem[],
  expiration: ExpirationPreset,
  pat: string,
  apiUrl: string,
): Promise<UploadSignResponse> {
  const url = `${apiUrl}/api/upload/sign`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pat}`,
      },
      body: JSON.stringify({
        files,
        expiration,
      }),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliApiError(`署名APIへの接続に失敗しました: ${detail}`, 0);
  }

  if (!response.ok) {
    let errorMessage = `署名URLの発行に失敗しました(${response.status})。`;
    let details: unknown;
    try {
      const errorJson = (await response.json()) as {
        error?: { message?: string; details?: unknown };
      };
      if (errorJson.error?.message) {
        errorMessage = errorJson.error.message;
      }
      details = errorJson.error?.details;
    } catch {
      /* noop */
    }
    throw new CliApiError(errorMessage, response.status, details);
  }

  return (await response.json()) as UploadSignResponse;
}

/**
 * R2 Presigned PUT URL に対してバイナリを直接アップロードする。
 * SigV4 署名の整合性を保つため、ヘッダーは `Content-Type` のみに限定する。
 *
 * @param uploadUrl - 署名済みPUT URL。
 * @param body - アップロードするバイナリデータ (`Buffer` または `Uint8Array`)。
 * @param mimeType - 署名時と同一のMIMEタイプ。
 */
export async function uploadDirectToR2(
  uploadUrl: string,
  body: Buffer | Uint8Array,
  mimeType: string,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType,
      },
      body: body as unknown as BodyInit,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliApiError(`ストレージへの直接転送に失敗しました: ${detail}`, 0);
  }

  if (!response.ok) {
    throw new CliApiError(
      `ストレージへのアップロードに失敗しました(${response.status})。`,
      response.status,
    );
  }
}

/**
 * ドキュメント確定コミットAPIを呼び出す。
 *
 * @param payload - コミット要求パラメータ。
 * @param pat - パーソナルアクセストークン。
 * @param apiUrl - APIベースURL。
 * @returns 確定コミットレスポンス。
 */
export async function commitDocument(
  payload: DocumentCommitRequest,
  pat: string,
  apiUrl: string,
): Promise<DocumentCommitResponse> {
  const url = `${apiUrl}/api/documents`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pat}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliApiError(`コミットAPIへの接続に失敗しました: ${detail}`, 0);
  }

  if (!response.ok) {
    let errorMessage = `ドキュメントの保存に失敗しました(${response.status})。`;
    let details: unknown;
    try {
      const errorJson = (await response.json()) as {
        error?: { message?: string; details?: unknown };
      };
      if (errorJson.error?.message) {
        errorMessage = errorJson.error.message;
      }
      details = errorJson.error?.details;
    } catch {
      /* noop */
    }
    throw new CliApiError(errorMessage, response.status, details);
  }

  return (await response.json()) as DocumentCommitResponse;
}

/** CLIで扱う認証済みユーザー詳細情報型。 */
export interface CurrentUserInfo extends AuthUser {
  /** PAT認可スコープ一覧(任意)。 */
  scopes?: string[];
  /** PATトークン名(任意)。 */
  tokenName?: string;
}

/**
 * PATを用いてログイン中ユーザー情報を取得する (`GET /api/auth/me`)。
 *
 * @param pat - パーソナルアクセストークン。
 * @param apiUrl - APIベースURL。
 * @returns 認証成功時はユーザー情報(スコープ・トークン名含む)、未認証・無効・接続失敗時は `null`。
 */
export async function fetchCurrentUser(
  pat: string,
  apiUrl: string,
): Promise<CurrentUserInfo | null> {
  const url = `${apiUrl}/api/auth/me`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${pat}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as AuthMeResponse;
    if (!data.user) {
      return null;
    }

    return {
      ...data.user,
      scopes: data.scopes,
      tokenName: data.tokenName,
    };
  } catch {
    return null;
  }
}

/**
 * PATの有効性およびAPIサーバーとの疎通を確認する。
 * `GET /api/auth/me` を呼び出し、有効なユーザー情報が返却されるかを判定する。
 *
 * @param pat - パーソナルアクセストークン。
 * @param apiUrl - APIベースURL。
 * @returns 疎通および認可成功時は `true`、認証失敗または無効な場合は `false`。
 */
export async function verifyPatConnectivity(
  pat: string,
  apiUrl: string,
): Promise<boolean> {
  const user = await fetchCurrentUser(pat, apiUrl);
  return user !== null;
}
