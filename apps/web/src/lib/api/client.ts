import type {
  DocumentCommitRequest,
  DocumentCommitResponse,
  UploadSignFileItem,
  UploadSignResponse,
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
 * @returns 署名発行レスポンス。
 */
export async function requestUploadSign(
  files: UploadSignFileItem[],
  baseUrl: string = getApiBaseUrl(),
): Promise<UploadSignResponse> {
  const url = `${baseUrl}/api/upload/sign`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
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

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
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
