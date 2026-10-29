import { PRESIGNED_URL_EXPIRATION_SECONDS } from '@patto-md/shared';
import { AwsClient } from 'aws4fetch';

/** デフォルトのR2バケット名。 */
export const DEFAULT_R2_BUCKET_NAME = 'patto-md-r2';

/**
 * R2オブジェクトキーが許容形式に適合しているかを判定する。
 * パストラバーサルを防ぎ、`temp/uploads/` から始まる一時アップロードのパス形式かを検証する。
 *
 * @param key - 検証対象のR2キー文字列。
 * @returns 形式が正当な場合は `true`、それ以外は `false`。
 */
export function isValidR2Key(key: string): boolean {
  if (!key || typeof key !== 'string') {
    return false;
  }
  if (key.includes('..') || key.startsWith('/') || key.includes('\\')) {
    return false;
  }
  return key.startsWith('temp/uploads/');
}

/**
 * ファイル名をサニタイズし、パストラバーサルや不正文字を排除する。
 *
 * @param fileName 元のファイル名。
 * @returns サニタイズされた安全なファイル名。
 */
export function sanitizeFileName(fileName: string): string {
  /** パス区切り文字で分割し、最後の要素(ファイル名部分)を取得したベースファイル名。 */
  const baseName = fileName.split(/[/\\]/).pop() ?? '';

  /** 制御文字・危険記号・空白をアンダースコアに置換し、先頭のドットや末尾のアンダースコアを除去されたファイル名。 */
  const sanitized = baseName
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^\.+/, '')
    .replace(/^_+|_+$/g, '');

  return sanitized.length > 0 ? sanitized : 'file';
}

/**
 * R2上に配置する一時オブジェクトキーを生成する。
 *
 * @param fileId 一意なファイル識別子(UUID)。
 * @param fileName 元のファイル名。
 * @returns R2オブジェクトキー。
 */
export function generateR2Key(fileId: string, fileName: string): string {
  const safeName = sanitizeFileName(fileName);
  return `temp/uploads/${fileId}/${safeName}`;
}

/** Presigned PUT URL生成のパラメータ定義。 */
export interface CreatePresignedPutUrlParams {
  /** Cloudflare アカウントID。 */
  accountId: string;

  /** R2 API トークンのアクセスキーID。 */
  accessKeyId: string;

  /** R2 API トークンのシークレットアクセスキー。 */
  secretAccessKey: string;

  /** 対象のR2バケット名。 */
  bucketName?: string;

  /** R2上の保存先オブジェクトキー。 */
  r2Key: string;

  /** 署名の有効期限(秒単位)。未指定時はデフォルト値を使用する。 */
  expiresInSeconds?: number;
}

/**
 * R2への直接アップロード(HTTP PUT)用Presigned URLを生成する。
 *
 * @param params 署名生成パラメータ。
 * @returns 署名済みアップロードURL。
 */
export async function createPresignedPutUrl(
  params: CreatePresignedPutUrlParams,
): Promise<string> {
  const bucketName = params.bucketName || DEFAULT_R2_BUCKET_NAME;
  const expiresIn = params.expiresInSeconds ?? PRESIGNED_URL_EXPIRATION_SECONDS;

  const endpointUrl = new URL(
    `https://${params.accountId}.r2.cloudflarestorage.com/${bucketName}/${params.r2Key}`,
  );
  endpointUrl.searchParams.set('X-Amz-Expires', expiresIn.toString());

  const client = new AwsClient({
    accessKeyId: params.accessKeyId,
    secretAccessKey: params.secretAccessKey,
    service: 's3',
    region: 'auto',
  });

  /** クエリストリング形式でSigV4署名を付与したリクエスト。 */
  const signedRequest = await client.sign(endpointUrl.toString(), {
    method: 'PUT',
    aws: {
      signQuery: true,
    },
  });

  return signedRequest.url;
}

/** R2クライアント認証情報の定義。 */
export interface R2ClientCredentials {
  accountId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucketName?: string;
}

/**
 * R2オブジェクトの存在確認を行う。
 * Workersバインディング(`bucket.head`)による確認を優先し、
 * ローカル開発環境等でバインディングから検出できない場合は、
 * S3互換APIクレデンシャルを用いて実ストレージへのHEADリクエストによるフォールバック確認を行う。
 *
 * @param bucket - Workers R2バケットバインディング。
 * @param key - 検証対象のR2キー文字列。
 * @param creds - S3互換APIクレデンシャル情報。
 * @returns オブジェクトが存在する場合は true、存在しない場合は false。
 */
export async function checkR2ObjectExists(
  bucket: R2Bucket,
  key: string,
  creds?: R2ClientCredentials,
): Promise<boolean> {
  try {
    const head = await bucket.head(key);
    if (head !== null) {
      return true;
    }
  } catch (error) {
    console.warn(`バインディング経由のHEAD確認エラー (${key}):`, error);
  }

  // ローカル開発環境向けフォールバック: S3互換APIによる実ストレージHEAD確認。
  if (creds?.accountId && creds?.accessKeyId && creds?.secretAccessKey) {
    try {
      const bucketName = creds.bucketName || DEFAULT_R2_BUCKET_NAME;
      const url = `https://${creds.accountId}.r2.cloudflarestorage.com/${bucketName}/${key}`;
      const client = new AwsClient({
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        service: 's3',
        region: 'auto',
      });
      const response = await client.fetch(url, { method: 'HEAD' });
      return response.status === 200;
    } catch (fallbackError) {
      console.warn(
        `S3互換HEADフォールバック確認エラー (${key}):`,
        fallbackError,
      );
    }
  }

  return false;
}

/**
 * R2からオブジェクトのテキスト(Markdown本文等)を取得する。
 * Workersバインディングを優先し、ローカル開発環境で検出できない場合はS3互換APIからフォールバック取得する。
 *
 * @param bucket - Workers R2バケットバインディング。
 * @param key - 取得対象のR2キー文字列。
 * @param creds - S3互換APIクレデンシャル情報。
 * @returns テキスト文字列。取得できなかった場合は null。
 */
export async function getR2Text(
  bucket: R2Bucket,
  key: string,
  creds?: R2ClientCredentials,
): Promise<string | null> {
  try {
    const object = await bucket.get(key);
    if (object !== null) {
      return await object.text();
    }
  } catch (error) {
    console.warn(`バインディング経由のテキスト取得エラー (${key}):`, error);
  }

  // ローカル開発環境向けフォールバック: S3互換APIによる実ストレージGET取得。
  if (creds?.accountId && creds?.accessKeyId && creds?.secretAccessKey) {
    try {
      const bucketName = creds.bucketName || DEFAULT_R2_BUCKET_NAME;
      const url = `https://${creds.accountId}.r2.cloudflarestorage.com/${bucketName}/${key}`;
      const client = new AwsClient({
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        service: 's3',
        region: 'auto',
      });
      const response = await client.fetch(url, { method: 'GET' });
      if (response.status === 200) {
        return await response.text();
      }
    } catch (fallbackError) {
      console.warn(
        `S3互換GETフォールバック取得エラー (${key}):`,
        fallbackError,
      );
    }
  }

  return null;
}

/**
 * R2からアセットのレスポンス(画像ストリーミング等)を取得する。
 * Workersバインディングを優先し、ローカル開発環境で検出できない場合はS3互換APIからフォールバック取得する。
 *
 * @param bucket - Workers R2バケットバインディング。
 * @param key - 取得対象のR2キー文字列。
 * @param creds - S3互換APIクレデンシャル情報。
 * @returns Response オブジェクトまたは null。
 */
export async function getR2AssetResponse(
  bucket: R2Bucket,
  key: string,
  creds?: R2ClientCredentials,
): Promise<Response | null> {
  try {
    const object = await bucket.get(key);
    if (object !== null) {
      const headers = new Headers();
      headers.set(
        'Content-Type',
        object.httpMetadata?.contentType || 'application/octet-stream',
      );
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      if (object.httpEtag) {
        headers.set('ETag', object.httpEtag);
      }
      return new Response(object.body, { headers });
    }
  } catch (error) {
    console.warn(`バインディング経由のアセット取得エラー (${key}):`, error);
  }

  // ローカル開発環境向けフォールバック: S3互換APIによる実ストレージGET取得。
  if (creds?.accountId && creds?.accessKeyId && creds?.secretAccessKey) {
    try {
      const bucketName = creds.bucketName || DEFAULT_R2_BUCKET_NAME;
      const url = `https://${creds.accountId}.r2.cloudflarestorage.com/${bucketName}/${key}`;
      const client = new AwsClient({
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        service: 's3',
        region: 'auto',
      });
      const response = await client.fetch(url, { method: 'GET' });
      if (response.status === 200) {
        const headers = new Headers(response.headers);
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        return new Response(response.body, {
          status: 200,
          headers,
        });
      }
    } catch (fallbackError) {
      console.warn(`S3互換アセット取得エラー (${key}):`, fallbackError);
    }
  }

  return null;
}
