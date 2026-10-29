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
