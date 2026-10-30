import { RATE_LIMIT_EXCEEDED_MESSAGE } from '@patto-md/shared/constants/limits';
import type { Context, MiddlewareHandler } from 'hono';

/** レートリミット判定結果の型定義。 */
export interface RateLimitResult {
  /** リクエストを許可するかどうかの真偽値。許可時は `true`、上限超過時は `false`。 */
  allowed: boolean;
  /** 当該ウィンドウで許可されている最大リクエスト数。 */
  limit: number;
  /** 当該ウィンドウ内でリクエスト可能な残存可能枠数。 */
  remaining: number;
  /** カウンタがリセットされる時刻(UNIX エポック秒)。 */
  resetAt: number;
  /** 次のリクエストが可能になるまでの待機秒数(1以上の整数)。超過時以外は0。 */
  retryAfter: number;
}

/** レートリミット状態を永続・集計するストレージインターフェース。 */
export interface RateLimitStore {
  /**
   * 指定されたキーのカウントを1加算し、現在のカウントとリセット時刻を返却する。
   *
   * @param key - 一意の識別キー(アクション名、IP アドレス、スロット番号等)。
   * @param windowSeconds - ウィンドウの有効期間(秒)。
   * @param nowMs - 現在時刻(ミリ秒)。
   * @param executionCtx - Cloudflare Workers の実行コンテキスト(`waitUntil` 用)。
   * @returns インクリメント後の累積カウント値とリセット時刻(`resetAt`: UNIX エポック秒)。
   */
  increment(
    key: string,
    windowSeconds: number,
    nowMs: number,
    executionCtx?: ExecutionContext,
  ): Promise<{ count: number; resetAt: number }>;
}

/** インメモリストア内部で保持するスロットデータ型。 */
interface MemorySlotData {
  /** 累積リクエスト数。 */
  count: number;
  /** リセット時刻(UNIX エポック秒)。 */
  resetAt: number;
}

/**
 * Cloudflare Workers のアイソレート内メモリを用いた軽量レートリミットストア。
 *
 * 外部通信やデータベース書き込みクォータを一切消費せず、0ms に近い極小のレイテンシで動作する。
 * 定期的な期限切れスロットのパージおよび最大件数制限により、メモリリークを防止する。
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  /** メモリ内に保持するエントリスロットのマップ。 */
  private readonly storage = new Map<string, MemorySlotData>();

  /** 保持可能な最大エントリ件数(上限超過時は古いエントリから破棄)。 */
  private readonly maxEntries: number;

  /**
   * インメモリストアを初期化する。
   *
   * @param maxEntries - 保持する最大エントリ数。既定値は5000。
   */
  constructor(maxEntries: number = 5000) {
    this.maxEntries = maxEntries;
  }

  /**
   * カウントを1加算し、最新のカウントとリセット時刻を取得する。
   *
   * @param key - キャッシュキー文字列。
   * @param windowSeconds - ウィンドウ幅(秒)。
   * @param nowMs - 現在時刻(ミリ秒)。
   * @returns カウント数およびリセット時刻。
   */
  async increment(
    key: string,
    windowSeconds: number,
    nowMs: number,
  ): Promise<{ count: number; resetAt: number }> {
    const currentEpochSeconds = Math.floor(nowMs / 1000);
    this.cleanup(currentEpochSeconds);

    const existing = this.storage.get(key);
    if (existing && existing.resetAt > currentEpochSeconds) {
      existing.count += 1;
      return {
        count: existing.count,
        resetAt: existing.resetAt,
      };
    }

    const currentWindowSlot = Math.floor(nowMs / (windowSeconds * 1000));
    const resetAt = (currentWindowSlot + 1) * windowSeconds;

    if (this.storage.size >= this.maxEntries) {
      const oldestKey = this.storage.keys().next().value;
      if (oldestKey !== undefined) {
        this.storage.delete(oldestKey);
      }
    }

    const newData: MemorySlotData = {
      count: 1,
      resetAt,
    };
    this.storage.set(key, newData);

    return newData;
  }

  /**
   * 期限切れとなった古いエントリを一括削除する。
   *
   * @param currentEpochSeconds - 現在の UNIX エポック秒。
   */
  private cleanup(currentEpochSeconds: number): void {
    for (const [key, data] of this.storage.entries()) {
      if (data.resetAt <= currentEpochSeconds) {
        this.storage.delete(key);
      }
    }
  }

  /** 現在保持しているエントリ件数を取得する(テスト検証用)。 */
  size(): number {
    return this.storage.size;
  }

  /** 全てのエントリを破棄して状態を初期化する(テスト用)。 */
  clear(): void {
    this.storage.clear();
  }
}

/**
 * Cloudflare Workers Cache API (`caches.default`) を活用したレートリミットストア。
 *
 * 同一データセンター(PoP)内のエッジキャッシュを活用し、無料枠リクエストや D1・KV クォータを消費せずに動作する。
 * `caches.default` が利用できない環境(ローカル Node.js テスト環境等)では、自動的に `InMemoryRateLimitStore` へフォールバックする。
 * なお、ミリ秒単位の並行アクセスに対しては厳密なアトミック性よりもエッジレイテンシと完全0円運用を優先し、
 * バースト攻撃やクォータ枯渇を抑止する Soft Rate Limit として設計されている。
 */
export class CacheRateLimitStore implements RateLimitStore {
  /** フォールバック用のインメモリストアインスタンス。 */
  private readonly fallbackStore = new InMemoryRateLimitStore();

  /** ダミー URL の基準ホスト。 */
  private readonly dummyOrigin = 'http://rate-limit.internal';

  /**
   * カウントを1加算し、Cache API またはメモリから最新状態を取得する。
   *
   * @param key - キャッシュキー文字列。
   * @param windowSeconds - ウィンドウ幅(秒)。
   * @param nowMs - 現在時刻(ミリ秒)。
   * @param executionCtx - 実行コンテキスト(`waitUntil` でのバックグラウンド書き込み用)。
   * @returns カウント数およびリセット時刻。
   */
  async increment(
    key: string,
    windowSeconds: number,
    nowMs: number,
    executionCtx?: ExecutionContext,
  ): Promise<{ count: number; resetAt: number }> {
    const defaultCache =
      typeof caches !== 'undefined' && caches && 'default' in caches
        ? (caches as unknown as { default: Cache }).default
        : undefined;

    if (!defaultCache) {
      return this.fallbackStore.increment(key, windowSeconds, nowMs);
    }

    const currentEpochSeconds = Math.floor(nowMs / 1000);
    const currentWindowSlot = Math.floor(nowMs / (windowSeconds * 1000));
    const resetAt = (currentWindowSlot + 1) * windowSeconds;
    const ttlSeconds = Math.max(1, resetAt - currentEpochSeconds);

    const cacheUrl = `${this.dummyOrigin}/${encodeURIComponent(key)}`;
    const cacheRequest = new Request(cacheUrl, { method: 'GET' });

    let count = 1;
    try {
      const cachedResponse = await defaultCache.match(cacheRequest);
      if (cachedResponse) {
        const cachedCount = parseInt(
          cachedResponse.headers.get('X-RateLimit-Current-Count') || '0',
          10,
        );
        if (Number.isFinite(cachedCount) && cachedCount > 0) {
          count = cachedCount + 1;
        }
      }
    } catch (error) {
      console.warn('Cache API読み取り失敗。メモリフォールバックを使用:', error);
      return this.fallbackStore.increment(key, windowSeconds, nowMs);
    }

    const responseToCache = new Response(null, {
      status: 200,
      headers: {
        'Cache-Control': `public, max-age=${ttlSeconds}`,
        'X-RateLimit-Current-Count': String(count),
        'X-RateLimit-Reset': String(resetAt),
      },
    });

    const putPromise = defaultCache
      .put(cacheRequest, responseToCache)
      .catch((error) => {
        console.warn('Cache API書き込み失敗:', error);
      });

    if (executionCtx && typeof executionCtx.waitUntil === 'function') {
      executionCtx.waitUntil(putPromise);
    } else {
      await putPromise;
    }

    return {
      count,
      resetAt,
    };
  }
}

/** アプリケーション全体で共有する既定のインメモリストアインスタンス。 */
export const defaultInMemoryStore = new InMemoryRateLimitStore();

/** アプリケーション全体で共有する既定のキャッシュストアインスタンス。 */
export const defaultCacheStore = new CacheRateLimitStore();

/**
 * Hono コンテキストからクライアントの IP アドレスを安全に抽出する。
 *
 * Cloudflare エッジが付与する `cf-connecting-ip` を最優先とし、
 * 存在しない場合は `x-forwarded-for` の先頭 IP、ローカルフォールバックとして `127.0.0.1` を返却する。
 *
 * @param c - Hono コンテキスト。
 * @returns 抽出された IP アドレス文字列。
 */
export function getClientIp(c: Context): string {
  const cfConnectingIp = c.req.header('cf-connecting-ip');
  if (cfConnectingIp && cfConnectingIp.trim().length > 0) {
    return cfConnectingIp.trim();
  }

  const forwardedFor = c.req.header('x-forwarded-for');
  if (forwardedFor && forwardedFor.trim().length > 0) {
    const firstIp = forwardedFor.split(',')[0]?.trim();
    if (firstIp && firstIp.length > 0) {
      return firstIp;
    }
  }

  return '127.0.0.1';
}

/** レートリミット判定パラメータの型定義。 */
export interface CheckRateLimitParams {
  /** エンドポイントまたはアクションの識別子。 */
  action: string;
  /** クライアントの IP アドレス。 */
  clientIp: string;
  /** ウィンドウ期間内に許可する最大リクエスト数。 */
  limit: number;
  /** ウィンドウの幅(秒)。 */
  windowSeconds: number;
  /** レートリミット状態の保持ストア。未指定時はデフォルトの `defaultCacheStore` を使用。 */
  store?: RateLimitStore;
  /** 現在時刻(ミリ秒)を返却する関数。テスト時の時刻モック用。 */
  now?: () => number;
  /** Cloudflare Workers の実行コンテキスト(`waitUntil` 用)。 */
  executionCtx?: ExecutionContext;
}

/**
 * レートリミットのコア判定を実行する。
 *
 * 固定ウィンドウ(Fixed Window)方式に基づき、現在スロット内の累積リクエスト数を集計し、
 * 上限枠内であるかどうかの判定結果と各種ヘッダー情報を算出する。
 *
 * @param params - 判定パラメータ。
 * @returns レートリミット判定結果オブジェクト。
 */
export async function checkRateLimit(
  params: CheckRateLimitParams,
): Promise<RateLimitResult> {
  const {
    action,
    clientIp,
    limit,
    windowSeconds,
    store = defaultCacheStore,
    now = Date.now,
    executionCtx,
  } = params;

  const nowMs = now();
  const currentEpochSeconds = Math.floor(nowMs / 1000);
  const currentWindowSlot = Math.floor(nowMs / (windowSeconds * 1000));
  const rateLimitKey = `rate-limit:${action}:${clientIp}:${currentWindowSlot}`;

  const { count, resetAt } = await store.increment(
    rateLimitKey,
    windowSeconds,
    nowMs,
    executionCtx,
  );

  const allowed = count <= limit;
  const remaining = Math.max(0, limit - count);
  const retryAfter = allowed ? 0 : Math.max(1, resetAt - currentEpochSeconds);

  return {
    allowed,
    limit,
    remaining,
    resetAt,
    retryAfter,
  };
}

/** レートリミットミドルウェアのオプション設定。 */
export interface RateLimitMiddlewareOptions {
  /** 1ウィンドウあたりの最大許容リクエスト数。 */
  limit: number;
  /** ウィンドウ時間(秒)。既定値は60秒。 */
  windowSeconds?: number;
  /** エンドポイント識別名(キー競合を防ぐためのプレフィックス)。 */
  action: string;
  /** レートリミット状態の保持ストア。未指定時はデフォルトの `defaultCacheStore` を使用。 */
  store?: RateLimitStore;
  /** 現在時刻(ミリ秒)を返却する関数。テスト時の時刻モック用。 */
  now?: () => number;
  /** クライアント IP 抽出関数。未指定時は `getClientIp` を使用。 */
  keyGenerator?: (c: Context) => string;
}

/**
 * エッジ環境で高速にリクエスト数を制限する Hono ミドルウェアを生成する。
 *
 * CORS プリフライト(`OPTIONS`)リクエストはカウント対象外としてスキップする。
 * 制限上限内であれば残枠数ヘッダー(`X-RateLimit-*`, `RateLimit-*`)を付与して後続処理へ進め、
 * 制限超過時は `429 Too Many Requests` レスポンスおよび `Retry-After` ヘッダーを即時返却する。
 *
 * @param options - レートリミット設定オプション。
 * @returns Hono ミドルウェアハンドラー。
 */
export function createRateLimitMiddleware<
  E extends { Bindings: Record<string, unknown> } = {
    Bindings: Record<string, unknown>;
  },
>(options: RateLimitMiddlewareOptions): MiddlewareHandler<E> {
  const {
    limit,
    windowSeconds = 60,
    action,
    store = defaultCacheStore,
    now = Date.now,
    keyGenerator = getClientIp,
  } = options;

  return async (c, next) => {
    if (c.req.method === 'OPTIONS') {
      return await next();
    }

    const clientIp = keyGenerator(c as unknown as Context);

    let executionCtx: ExecutionContext | undefined;
    try {
      executionCtx = c.executionCtx as unknown as ExecutionContext;
    } catch {
      // テスト環境など実行コンテキストが存在しない環境では undefined として扱う。
    }

    const result: RateLimitResult = await checkRateLimit({
      action,
      clientIp,
      limit,
      windowSeconds,
      store,
      now,
      executionCtx,
    });

    c.header('X-RateLimit-Limit', String(result.limit));
    c.header('X-RateLimit-Remaining', String(result.remaining));
    c.header('X-RateLimit-Reset', String(result.resetAt));
    c.header('RateLimit-Limit', String(result.limit));
    c.header('RateLimit-Remaining', String(result.remaining));
    c.header('RateLimit-Reset', String(result.resetAt));

    if (!result.allowed) {
      c.header('Retry-After', String(result.retryAfter));
      return c.json(
        {
          error: {
            message: RATE_LIMIT_EXCEEDED_MESSAGE,
          },
        },
        429,
      );
    }

    return await next();
  };
}
