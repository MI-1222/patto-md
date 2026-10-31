import { Hono } from 'hono';
import { getR2AssetResponse, isValidR2Key } from '../lib/r2';
import type { AppEnv } from '../types';

/** アセット配信用のサブルーター。 */
export const assetsRouter = new Hono<AppEnv>();

/**
 * R2オブジェクトアセット配信エンドポイント。
 *
 * Markdown本文に埋め込まれた画像などのアセットをストリーミング配信する。
 * 不変アセットとして長期の `Cache-Control` ヘッダーを付与し、R2の転送・実行コストを抑える。
 *
 * セキュリティ設計上の境界とトレードオフ:
 * パスコード保護ドキュメントであっても、画像などのアセット自体は推測不能な UUID を含む
 * ケイパビリティ URL モデルとして配信する。これにより、CDN によるエッジキャッシュと
 * 高速表示、Cloudflare Workers の CPU 時間削減を両立する。Markdown 本文は厳格に認可保護するが、
 * 画像 URL を直接知るクライアントには配信されるトレードオフを前提とする。
 */
assetsRouter.get('/:key{.+}', async (c) => {
  /** リクエストパスから抽出したR2オブジェクトキー。 */
  const key = c.req.param('key');

  if (!isValidR2Key(key)) {
    return c.json(
      {
        error: {
          message: '無効なオブジェクトキー形式。',
        },
      },
      400,
    );
  }

  const r2Creds = {
    accountId: c.env.CLOUDFLARE_ACCOUNT_ID,
    accessKeyId: c.env.R2_ACCESS_KEY_ID,
    secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
    bucketName: c.env.R2_BUCKET_NAME,
  };

  try {
    const response = await getR2AssetResponse(c.env.BUCKET, key, r2Creds);

    if (!response) {
      return c.json(
        {
          error: {
            message: 'アセットが見つかりません。',
          },
        },
        404,
      );
    }

    return response;
  } catch (error) {
    console.error('R2アセット取得エラー:', error);
    return c.json(
      {
        error: {
          message: 'アセットの読み込みに失敗しました。',
        },
      },
      500,
    );
  }
});
