import { bytesToHex } from '@patto-md/shared/utils/token';

/**
 * クライアントのIPアドレスをソルト(ペッパー)と組み合わせてSHA-256ハッシュ化する。
 *
 * 単純なSHA-256ではIPv4空間(約43億通り)がレインボーテーブルで即座に逆引きされてしまうため、
 * サーバー側シークレット(ペッパー)を連結してハッシュ化し、プライバシーを保護する。
 *
 * @param ip - クライアントのIPアドレス文字列。
 * @param pepper - サーバー側シークレット文字列(未指定時はフォールバック文字列を使用)。
 * @returns 小文字16進数のSHA-256ハッシュ文字列。
 */
export async function hashClientIp(
  ip: string,
  pepper?: string,
): Promise<string> {
  const secret =
    pepper && pepper.length > 0 ? pepper : 'patto-md-abuse-pepper-fallback';
  const encoder = new TextEncoder();
  const data = encoder.encode(`${secret}:${ip.trim()}`);
  const digestBuffer = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digestBuffer));
}
