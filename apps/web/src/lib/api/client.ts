import {
  TURNSTILE_TOKEN_HEADER,
  type AuthUser,
  type DocumentClaimResponse,
  type DocumentCommitRequest,
  type DocumentCommitResponse,
  type DocumentListResponse,
  type DocumentResponse,
  type DocumentUpdateRequest,
  type DocumentUpdateResponse,
  type DocumentVerifyPasscodeResponse,
  type UploadSignFileItem,
  type UploadSignResponse,
} from '@patto-md/shared';

/**
 * APIのエンドポイントベースURLを取得する。
 * 環境変数 `PUBLIC_API_URL` が設定されている場合は優先して使用し、
 * 未設定時はローカル開発用デフォルトポート (`http://localhost:8787`) を使用する。
 *
 * @returns 正規化されたAPIベースURL。
 */
export function getApiBaseUrl(): string {
  if (
    typeof globalThis !== 'undefined' &&
    (globalThis as unknown as { __PATTO_API_URL__?: string }).__PATTO_API_URL__
  ) {
    return (
      globalThis as unknown as { __PATTO_API_URL__?: string }
    ).__PATTO_API_URL__!.replace(/\/+$/, '');
  }

  const envUrl = import.meta.env?.PUBLIC_API_URL;
  if (typeof envUrl === 'string' && envUrl.trim().length > 0) {
    return envUrl.trim().replace(/\/+$/, '');
  }

  return 'http://localhost:8787';
}

/**
 * サーバーサイド(SSR)実行時のAPIベースURLを解決する。
 *
 * 開発モード(`import.meta.env.DEV`)時はローカルAPI(`http://localhost:8787`)を優先し、
 * 本番環境ではCloudflare Workersランタイムの環境変数を参照する。
 *
 * @param locals - Astroの `locals` オブジェクト。
 * @returns 正規化されたAPIベースURL。
 */
export function resolveServerApiBaseUrl(locals?: unknown): string {
  if (import.meta.env.DEV) {
    const devUrl = import.meta.env.PUBLIC_API_URL;
    return typeof devUrl === 'string' && devUrl.trim().length > 0
      ? devUrl.trim().replace(/\/+$/, '')
      : 'http://localhost:8787';
  }

  const runtimeEnv = (
    locals as { runtime?: { env?: { PUBLIC_API_URL?: string } } } | undefined
  )?.runtime?.env;

  const runtimeUrl =
    runtimeEnv?.PUBLIC_API_URL || import.meta.env.PUBLIC_API_URL;
  if (typeof runtimeUrl === 'string' && runtimeUrl.trim().length > 0) {
    return runtimeUrl.trim().replace(/\/+$/, '');
  }

  return 'http://localhost:8787';
}

/**
 * Astro locals から Cloudflare Service Binding (`API`) の Fetcher 関数を取得する。
 * Service Binding が存在する場合は内部高速通信用の fetch を返し、
 * 存在しない環境(ローカル開発・テスト等)では標準のグローバル `fetch` を返す。
 *
 * @param locals - Astro の `locals` オブジェクト。
 * @returns リクエスト送信用の fetch 関数。
 */
export function getFetcher(locals?: unknown): typeof fetch {
  const service = (
    locals as
      { runtime?: { env?: { API?: { fetch: typeof fetch } } } } | undefined
  )?.runtime?.env?.API;

  if (service && typeof service.fetch === 'function') {
    return service.fetch.bind(service);
  }

  return fetch;
}

/**
 * API通信時のエラーを表現するクラス。
 */
export class ApiError extends Error {
  /** HTTPステータスコード。 */
  readonly status: number;
  /** 詳細情報オブジェクト。 */
  readonly details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

/**
 * アップロード署名発行API (`POST /api/upload/sign`) を呼び出す。
 *
 * @param files - 署名を要求するファイル一覧。
 * @param baseUrl - 接続先APIベースURL。未指定時は `getApiBaseUrl()` を使用する。
 * @param turnstileToken - Cloudflare Turnstile ボット検証トークン。
 * @returns 署名発行レスポンス。
 */
export async function requestUploadSign(
  files: UploadSignFileItem[],
  baseUrl: string = getApiBaseUrl(),
  turnstileToken?: string,
): Promise<UploadSignResponse> {
  const url = `${baseUrl}/api/upload/sign`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (turnstileToken && turnstileToken.trim().length > 0) {
    headers[TURNSTILE_TOKEN_HEADER] = turnstileToken;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ files }),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ApiError(`署名APIへの接続に失敗しました: ${detail}`, 0);
  }

  if (!response.ok) {
    let errorMessage = '署名付きURLの発行に失敗しました。';
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
    throw new ApiError(errorMessage, response.status, details);
  }

  return (await response.json()) as UploadSignResponse;
}

/**
 * R2のPresigned PUT URLに対してバイナリを直接アップロードする。
 * SigV4署名との不一致を防ぐため、追加ヘッダーは `Content-Type` のみに限定する。
 *
 * @param uploadUrl - 署名済みPUT URL。
 * @param fileOrBlob - アップロード対象のファイルまたはBlob実体。
 * @param mimeType - ファイルのMIMEタイプ。
 */
export async function uploadToR2(
  uploadUrl: string,
  fileOrBlob: Blob | File,
  mimeType: string,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType,
      },
      body: fileOrBlob,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ApiError(`ストレージへの転送に失敗しました: ${detail}`, 0);
  }

  if (!response.ok) {
    throw new ApiError(
      `ストレージへのアップロードに失敗しました(${response.status})。`,
      response.status,
    );
  }
}

/**
 * ドキュメント確定コミットAPI (`POST /api/documents`) を呼び出す。
 *
 * @param payload - コミット要求パラメータ。
 * @param baseUrl - 接続先APIベースURL。未指定時は `getApiBaseUrl()` を使用する。
 * @returns 確定コミットレスポンス。
 */
export async function commitDocument(
  payload: DocumentCommitRequest,
  baseUrl: string = getApiBaseUrl(),
): Promise<DocumentCommitResponse> {
  const url = `${baseUrl}/api/documents`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ApiError(`コミットAPIへの接続に失敗しました: ${detail}`, 0);
  }

  if (!response.ok) {
    let errorMessage = 'ドキュメントの保存に失敗しました。';
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
    throw new ApiError(errorMessage, response.status, details);
  }

  return (await response.json()) as DocumentCommitResponse;
}

/**
 * ドキュメント更新API (`PUT /api/documents/:id`) を呼び出す。
 *
 * @param id - ドキュメントID(`Slug`)。
 * @param payload - 更新パラメータ。
 * @param token - 認可トークン(`edit` または `modify` トークン)。
 * @param baseUrl - 接続先APIベースURL。未指定時は `getApiBaseUrl()` を使用する。
 * @returns ドキュメント更新レスポンス。
 */
export async function updateDocument(
  id: string,
  payload: DocumentUpdateRequest,
  token: string,
  baseUrl: string = getApiBaseUrl(),
): Promise<DocumentUpdateResponse> {
  /** ドキュメント更新APIのエンドポイントURL。 */
  const url = `${baseUrl}/api/documents/${id}`;

  /** 認可トークンを含むリクエストヘッダー。 */
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify(payload),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ApiError(
      `ドキュメント更新APIへの接続に失敗しました: ${detail}`,
      0,
    );
  }

  if (!response.ok) {
    let errorMessage = 'ドキュメントの更新に失敗しました。';
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
    throw new ApiError(errorMessage, response.status, details);
  }

  return (await response.json()) as DocumentUpdateResponse;
}

/** ドキュメント取得APIのレスポンス型。 */
export interface FetchDocumentResult {
  /** ドキュメントの詳細データ。 */
  document: DocumentResponse;
  /** レスポンスの `Cache-Control` ヘッダー値。 */
  cacheControl: string | null;
}

/**
 * ドキュメント詳細取得API (`GET /api/documents/:id`) を呼び出し、ドキュメント情報とキャッシュ制御ヘッダーを取得する。
 * パスコード保護ドキュメントで未認証(401)の場合は、本文を秘匿した保護メタデータを透過して返却する。
 *
 * @param id - ドキュメントID(`Slug`)。
 * @param baseUrl - 接続先APIのベースURL。未指定時は `getApiBaseUrl()` の戻り値を使用する。
 * @param customFetch - リクエスト送信に使用するカスタム fetch 関数(`Service Binding` 等)。
 * @param options - 認証 `Cookie` または `Bearer` トークンなどの追加オプション。
 * @returns ドキュメント詳細および `Cache-Control` ヘッダー値を含むオブジェクト。
 */
export async function fetchDocument(
  id: string,
  baseUrl: string = getApiBaseUrl(),
  customFetch: typeof fetch = fetch,
  options?: {
    cookie?: string | null;
    token?: string | null;
  },
): Promise<FetchDocumentResult> {
  /** ドキュメント詳細取得APIのエンドポイントURL。 */
  const url = `${baseUrl}/api/documents/${id}`;

  const headers: Record<string, string> = {};
  if (options?.cookie) {
    headers.Cookie = options.cookie;
  }
  if (options?.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  let response: Response;
  try {
    response = await customFetch(url, {
      method: 'GET',
      headers,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ApiError(
      `ドキュメント取得APIへの接続に失敗しました: ${detail}`,
      0,
    );
  }

  if (!response.ok) {
    let errorMessage = 'ドキュメントの取得に失敗しました。';
    let details: unknown;
    try {
      const errorJson = (await response.json()) as {
        error?: { message?: string; details?: unknown };
        document?: DocumentResponse;
      };

      if (response.status === 401 && errorJson.document?.isProtected) {
        return {
          document: errorJson.document,
          cacheControl: 'private, no-cache, no-store',
        };
      }

      if (errorJson.error?.message) {
        errorMessage = errorJson.error.message;
      }
      details = errorJson.error?.details;
    } catch {
      /* noop */
    }
    throw new ApiError(errorMessage, response.status, details);
  }

  /** APIから取得したドキュメント詳細レスポンス。 */
  const document = (await response.json()) as DocumentResponse;
  /** レスポンスから取得した `Cache-Control` ヘッダー値。 */
  const cacheControl = response.headers.get('cache-control');

  return {
    document,
    cacheControl,
  };
}

/**
 * パスコード照合API (`POST /api/documents/:id/verify-passcode`) を呼び出す。
 *
 * @param id - ドキュメントID(`Slug`)。
 * @param passcode - 入力されたパスコード文字列。
 * @param baseUrl - 接続先APIベースURL。未指定時は `getApiBaseUrl()` を使用する。
 * @returns パスコード照合レスポンス。
 */
export async function verifyPasscode(
  id: string,
  passcode: string,
  baseUrl: string = getApiBaseUrl(),
): Promise<DocumentVerifyPasscodeResponse> {
  const url = `${baseUrl}/api/documents/${id}/verify-passcode`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ passcode }),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ApiError(`パスコード照合APIへの接続に失敗しました: ${detail}`, 0);
  }

  if (!response.ok) {
    let errorMessage = 'パスコードの照合に失敗しました。';
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
    throw new ApiError(errorMessage, response.status, details);
  }

  return (await response.json()) as DocumentVerifyPasscodeResponse;
}

/** ドキュメント一覧取得オプションの定義。 */
export interface FetchDocumentsParams {
  /** 取得するページ番号(1始まり)。 */
  page?: number;
  /** 1ページあたりの取得件数。 */
  limit?: number;
  /** 絞り込み対象のドキュメントID配列。 */
  ids?: string[];
  /** ログイン中ユーザー自身の所有ドキュメントのみを取得するかどうか。 */
  mine?: boolean;
  /** 接続先APIのベースURL。 */
  baseUrl?: string;
  /** リクエスト送信に使用するカスタム fetch 関数(Service Binding 等)。 */
  customFetch?: typeof fetch;
}

/** ドキュメント一覧取得結果の型定義。 */
export interface FetchDocumentsResult {
  /** ドキュメント一覧レスポンスデータ。 */
  data: DocumentListResponse;
  /** レスポンスの `Cache-Control` ヘッダー値。 */
  cacheControl: string | null;
}

/**
 * ドキュメント一覧取得API (`GET /api/documents`) を呼び出し、一覧データとキャッシュ制御ヘッダーを取得する。
 *
 * @param params - 取得オプション。
 * @returns 一覧データおよび `Cache-Control` ヘッダー値を含むオブジェクト。
 */
export async function fetchDocuments(
  params: FetchDocumentsParams = {},
): Promise<FetchDocumentsResult> {
  const {
    page,
    limit,
    ids,
    mine,
    baseUrl = getApiBaseUrl(),
    customFetch = fetch,
  } = params;

  const query = new URLSearchParams();
  if (page !== undefined && page > 0) {
    query.set('page', String(page));
  }
  if (limit !== undefined && limit > 0) {
    query.set('limit', String(limit));
  }
  if (mine) {
    query.set('mine', 'true');
  } else if (ids && ids.length > 0) {
    query.set('ids', ids.join(','));
  }

  const queryString = query.toString();
  /** リクエスト先のエンドポイントURL。 */
  const url = `${baseUrl}/api/documents${queryString ? `?${queryString}` : ''}`;

  let response: Response;
  try {
    const fetchOptions: RequestInit = {
      method: 'GET',
    };
    if (mine) {
      fetchOptions.credentials = 'include';
    }
    response = await customFetch(url, fetchOptions);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ApiError(
      `ドキュメント一覧取得APIへの接続に失敗しました: ${detail}`,
      0,
    );
  }

  if (!response.ok) {
    let errorMessage = 'ドキュメント一覧の取得に失敗しました。';
    let details: unknown;
    try {
      const errorJson = (await response.json()) as {
        error?: { message?: string; details?: unknown };
      };
      if (errorJson.error?.message) {
        errorMessage = errorJson.error.message;
      }
      details = errorJson.error?.details;
    } catch {}
    throw new ApiError(errorMessage, response.status, details);
  }

  const data = (await response.json()) as DocumentListResponse;
  const cacheControl = response.headers.get('cache-control');

  return {
    data,
    cacheControl,
  };
}

/**
 * 匿名ドキュメントの所有権移譲API (`POST /api/documents/:id/claim`) を呼び出す。
 *
 * @param id - 対象ドキュメントID(`slug`)。
 * @param editToken - 特権管理トークン(`edit_token`)。
 * @param baseUrl - 接続先APIのベースURL。
 * @returns 所有権移譲完了レスポンス。
 */
export async function claimDocument(
  id: string,
  editToken: string,
  baseUrl: string = getApiBaseUrl(),
): Promise<DocumentClaimResponse> {
  const url = `${baseUrl}/api/documents/${id}/claim`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ editToken }),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ApiError(`所有権移譲APIへの接続に失敗しました: ${detail}`, 0);
  }

  if (!response.ok) {
    let errorMessage = '所有権の移譲に失敗しました。';
    let details: unknown;
    try {
      const errorJson = (await response.json()) as {
        error?: { message?: string; details?: unknown };
      };
      if (errorJson.error?.message) {
        errorMessage = errorJson.error.message;
      }
      details = errorJson.error?.details;
    } catch {}
    throw new ApiError(errorMessage, response.status, details);
  }

  return (await response.json()) as DocumentClaimResponse;
}

/**
 * 現在ログイン中ユーザーの情報取得API (`GET /api/auth/me`) を呼び出す。
 *
 * @param baseUrl - 接続先APIのベースURL。
 * @returns ログイン中ユーザー情報。未認証時は `null`。
 */
export async function fetchCurrentUser(
  baseUrl: string = getApiBaseUrl(),
): Promise<AuthUser | null> {
  const url = `${baseUrl}/api/auth/me`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  try {
    const json = (await response.json()) as { user?: AuthUser | null };
    return json.user ?? null;
  } catch {
    return null;
  }
}

/**
 * ログアウトAPI (`POST /api/auth/logout`) を呼び出す。
 *
 * @param baseUrl - 接続先APIのベースURL。
 * @returns ログアウト結果。
 */
export async function logout(
  baseUrl: string = getApiBaseUrl(),
): Promise<{ success: boolean }> {
  const url = `${baseUrl}/api/auth/logout`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ApiError(`ログアウトAPIへの接続に失敗しました: ${detail}`, 0);
  }

  if (!response.ok) {
    throw new ApiError('ログアウトに失敗しました。', response.status);
  }

  return (await response.json()) as { success: boolean };
}
