/** パーソナルアクセストークン(PAT)ユーティリティのエクスポート集約。 */

import {
  hashPat,
  timingSafeEqualHex,
  type OwnerProvider,
  type TokenScope,
  type UserApiTokenRecord,
} from '@patto-md/shared';
import type { PatAuthContext } from '../types.ts';

export {
  calculatePatExpiration,
  formatMaskedPat,
  generatePat,
  hashPat,
  isPat,
  maskPat,
  verifyPat,
} from '@patto-md/shared';

/** D1書き込みクォータ防衛のための `last_used_at` 更新間隔(ミリ秒)。5分間。 */
export const PAT_LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

/** 非同期タスク登録をサポートする実行コンテキストのインターフェース。 */
export interface PatExecutionContext {
  waitUntil: (promise: Promise<unknown>) => void;
}

/**
 * Hono コンテキストから Workers 実行コンテキストを安全に取得する。
 *
 * テスト環境などで `executionCtx` が存在しない場合でも例外を投げずに `undefined` を返す。
 *
 * @param c - Hono コンテキスト。
 * @returns 実行コンテキスト。存在しない場合は `undefined`。
 */
export function safelyGetExecutionCtx(c: {
  executionCtx?: unknown;
}): PatExecutionContext | undefined {
  try {
    return c.executionCtx as PatExecutionContext | undefined;
  } catch {
    return undefined;
  }
}

/**
 * プロバイダ種別とプロバイダ側ユーザーIDから、不変のユーザー識別子文字列を生成する。
 *
 * @param provider - 認証プロバイダ種別(`github` または `discord`)。
 * @param providerUserId - プロバイダ側で一意なユーザー識別子文字列。
 * @returns `${provider}:${providerUserId}` 形式の文字列。
 */
export function buildUserId(
  provider: OwnerProvider,
  providerUserId: string,
): string {
  return `${provider}:${providerUserId}`;
}

/**
 * ユーザー識別子文字列(`${provider}:${providerUserId}`)をプロバイダ種別とプロバイダ側ユーザーIDに分解する。
 *
 * @param userId - `${provider}:${providerUserId}` 形式の文字列。
 * @returns 分解結果。形式不正時は `null`。
 */
export function parseUserId(
  userId: string,
): { provider: OwnerProvider; providerUserId: string } | null {
  if (!userId || typeof userId !== 'string') {
    return null;
  }
  const separatorIndex = userId.indexOf(':');
  if (separatorIndex <= 0) {
    return null;
  }
  const provider = userId.slice(0, separatorIndex);
  const providerUserId = userId.slice(separatorIndex + 1);
  if (!providerUserId || (provider !== 'github' && provider !== 'discord')) {
    return null;
  }
  return {
    provider: provider as OwnerProvider,
    providerUserId,
  };
}

/**
 * 平文 PAT トークンを D1 データベース内のレコードと照合し、有効な認可情報を解決する。
 *
 * タイミング攻撃を防ぐため定数時間比較を行い、遅延評価によって有効期限を判定する。
 * また、D1 の書き込みクォータを防衛するため、前回更新から5分以上経過している場合のみ `last_used_at` を非同期で更新する。
 *
 * @param params - 検証パラメータ。
 * @param params.db - Cloudflare D1 データベースインスタンス。
 * @param params.token - クライアントから送信された平文 PAT トークン。
 * @param params.executionCtx - 非同期タスク登録用の Workers 実行コンテキスト。
 * @returns 解決された PAT 認可情報。無効または期限切れ時は `null`。
 */
export async function verifyAndResolvePat(params: {
  db: D1Database;
  token: string;
  executionCtx?: PatExecutionContext;
}): Promise<PatAuthContext | null> {
  const { db, token, executionCtx } = params;

  if (!token || !token.startsWith('pmd_pat_')) {
    return null;
  }

  let tokenHash: string;
  try {
    tokenHash = await hashPat(token);
  } catch (error) {
    console.error('PAT のハッシュ計算に失敗しました。', error);
    return null;
  }

  let record: UserApiTokenRecord | null = null;
  try {
    record = await db
      .prepare(
        `SELECT
          id,
          user_id,
          name,
          token_hash,
          scopes,
          expires_at,
          last_used_at,
          created_at
        FROM user_api_tokens
        WHERE token_hash = ?
        LIMIT 1`,
      )
      .bind(tokenHash)
      .first<UserApiTokenRecord>();
  } catch (error) {
    console.error('D1 PAT レコードの参照に失敗しました。', error);
    return null;
  }

  if (!record) {
    return null;
  }

  const isHashMatched = timingSafeEqualHex(tokenHash, record.token_hash);
  if (!isHashMatched) {
    return null;
  }

  if (record.expires_at) {
    const expiresAt = new Date(record.expires_at).getTime();
    if (expiresAt <= Date.now()) {
      return null;
    }
  }

  let scopes: TokenScope[] = [];
  try {
    const parsedScopes = JSON.parse(record.scopes);
    if (Array.isArray(parsedScopes)) {
      scopes = parsedScopes as TokenScope[];
    }
  } catch (error) {
    console.error('PAT スコープの JSON パースに失敗しました。', error);
    return null;
  }

  const now = Date.now();
  const lastUsedTime = record.last_used_at
    ? new Date(record.last_used_at).getTime()
    : null;
  const shouldUpdateLastUsed =
    lastUsedTime === null || now - lastUsedTime >= PAT_LAST_USED_THROTTLE_MS;

  if (shouldUpdateLastUsed) {
    /**
     * D1 書き込みクォータを防衛しつつ、最終利用日時を非同期で更新する。
     * 初回利用時、または前回記録から5分以上経過している場合のみ更新クエリを発行する。
     */
    const updatePromise = (async (): Promise<void> => {
      try {
        const nowIso = new Date(now).toISOString();
        await db
          .prepare(
            `UPDATE user_api_tokens
             SET last_used_at = ?
             WHERE id = ?`,
          )
          .bind(nowIso, record.id)
          .run();
      } catch (err) {
        console.error('PAT last_used_at の非同期更新に失敗しました。', err);
      }
    })();

    if (executionCtx && typeof executionCtx.waitUntil === 'function') {
      executionCtx.waitUntil(updatePromise);
    }
  }

  return {
    tokenId: record.id,
    userId: record.user_id,
    name: record.name,
    scopes,
  };
}
