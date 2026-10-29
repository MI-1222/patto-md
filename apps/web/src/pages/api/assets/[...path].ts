import type { APIRoute } from 'astro';
import { getFetcher, resolveServerApiBaseUrl } from '../../../lib/api';

/**
 * アセット配信用リバースプロキシエンドポイント。
 *
 * フロントエンドとAPIが別オリジンの環境(ローカル開発など)や相対パスの参照時に、
 * ブラウザからの `/api/assets/...` へのリクエストをバックエンドAPIへ中継する。
 *
 * なお、通常のHTML配信時は `renderMarkdown` により画像パスがAPIの絶対URLへ置換されるため、
 * ブラウザはAPIへ直接アクセスする。本エンドポイントはセーフティネットとして動作する。
 */
export const GET: APIRoute = async ({ params, locals }) => {
  const assetPath = params.path;
  if (!assetPath) {
    return new Response('無効なアセットパス。', { status: 400 });
  }

  /** 解決されたAPIベースURL。 */
  const apiBaseUrl = resolveServerApiBaseUrl(locals);
  /** 解決されたFetcher(Service Binding優先)。 */
  const fetcher = getFetcher(locals);
  /** バックエンドAPIのアセット取得エンドポイントURL。 */
  const targetUrl = `${apiBaseUrl}/api/assets/${assetPath}`;

  try {
    const apiResponse = await fetcher(targetUrl);

    if (!apiResponse.ok) {
      return new Response(apiResponse.body, {
        status: apiResponse.status,
        headers: {
          'Content-Type':
            apiResponse.headers.get('Content-Type') || 'text/plain',
        },
      });
    }

    /** キャッシュ制御やコンテンツタイプを引き継ぐレスポンスヘッダー。 */
    const headers = new Headers();
    const contentType = apiResponse.headers.get('Content-Type');
    const cacheControl = apiResponse.headers.get('Cache-Control');
    const etag = apiResponse.headers.get('ETag');

    if (contentType) {
      headers.set('Content-Type', contentType);
    }
    if (cacheControl) {
      headers.set('Cache-Control', cacheControl);
    }
    if (etag) {
      headers.set('ETag', etag);
    }

    return new Response(apiResponse.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error('アセットプロキシ転送エラー:', error);
    return new Response('アセットの転送に失敗しました。', { status: 502 });
  }
};
