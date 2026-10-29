import { Hono } from 'hono';
import { isValidR2Key } from '../lib/r2';
import type { AppEnv } from '../types';

/** アセット配信用のサブルーター。 */
export const assetsRouter = new Hono<AppEnv>();

/**
 * R2オブジェクトアセット配信エンドポイント。
 *
 * Markdown本文に埋め込まれた画像などのアセットをストリーミング配信する。
 * 不変アセットとして長期の `Cache-Control` ヘッダーを付与し、R2の転送・実行コストを抑える。
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

  try {
    /** R2バケットから取得したオブジェクト。 */
    const object = await c.env.BUCKET.get(key);

    if (!object) {
      return c.json(
        {
          error: {
            message: 'アセットが見つかりません。',
          },
        },
        404,
      );
    }

    c.header(
      'Content-Type',
      object.httpMetadata?.contentType || 'application/octet-stream',
    );
    c.header('Cache-Control', 'public, max-age=31536000, immutable');

    if (object.httpEtag) {
      c.header('ETag', object.httpEtag);
    }

    return c.body(object.body);
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
