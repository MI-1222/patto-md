import { SHARED_MODULE_NAME, TURNSTILE_TOKEN_HEADER } from '@patto-md/shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { documentsRouter } from './routes/documents';
import { uploadRouter } from './routes/upload';
import { assetsRouter } from './routes/assets';
import { resolveAllowedOrigin } from './lib/cors';
import type { AppEnv } from './types';

export * from './types';
export { resolveAllowedOrigin } from './lib/cors';

/** Hono アプリケーションインスタンスの初期化。 */
const app = new Hono<AppEnv>();

// アクセスログ出力ミドルウェアの登録。
app.use('*', logger());

// CORS(Cross-Origin Resource Sharing)ミドルウェアの設定。
app.use(
  '*',
  cors({
    origin: (origin, c) => resolveAllowedOrigin(origin, c.env.FRONTEND_ORIGIN),
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Content-Type',
      'Authorization',
      TURNSTILE_TOKEN_HEADER,
      'X-Turnstile-Token',
      'cf-turnstile-response',
    ],
    maxAge: 86400,
  }),
);

// 未検出ルートのハンドリング。
app.notFound((c) => {
  return c.json(
    {
      error: {
        message: 'Not Found',
      },
    },
    404,
  );
});

// グローバルエラーハンドリング。
app.onError((error, c) => {
  console.error('Unhandled API Error:', error);
  return c.json(
    {
      error: {
        message: 'Internal Server Error',
      },
    },
    500,
  );
});

/** サービスヘルスチェックエンドポイント。 */
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    module: SHARED_MODULE_NAME,
  });
});

/** APIルート経由のヘルスチェックエンドポイント。 */
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    module: SHARED_MODULE_NAME,
  });
});

/** ファイルアップロード関連APIサブルーターのマウント。 */
app.route('/api/upload', uploadRouter);

/** ドキュメント関連APIサブルーターのマウント。 */
app.route('/api/documents', documentsRouter);

/** アセット配信関連APIサブルーターのマウント。 */
app.route('/api/assets', assetsRouter);

export default app;
