/**
 * ブラウザの `localStorage` を用いた通報済みドキュメントID管理ユーティリティ。
 *
 * 同一ブラウザからの重複通報送信をUIレベルで抑止する。
 */
import { SLUG_PATTERN } from '@patto-md/shared';

/** `localStorage` の保存キー名。 */
export const REPORTED_DOCUMENTS_STORAGE_KEY = 'patto_md_reported_document_ids';

/** 最大保持件数。 */
const MAX_REPORTED_STORED_COUNT = 100;

/**
 * 当ブラウザで通報を送信したドキュメントID一覧を取得する。
 *
 * @returns 通報済みドキュメントID(`slug`)の配列。
 */
export function getReportedDocumentIds(): string[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(REPORTED_DOCUMENTS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (item): item is string =>
        typeof item === 'string' && SLUG_PATTERN.test(item),
    );
  } catch (error) {
    console.warn(
      'localStorage からの通報済みドキュメントID読み込みに失敗。',
      error,
    );
    return [];
  }
}

/**
 * 指定されたドキュメントが当ブラウザで通報済みかどうかを判定する。
 *
 * @param id - ドキュメントID(`slug`)。
 * @returns 通報済みの場合は `true`。
 */
export function isDocumentReported(id: string): boolean {
  if (!id || !SLUG_PATTERN.test(id)) {
    return false;
  }
  const reportedIds = getReportedDocumentIds();
  return reportedIds.includes(id);
}

/**
 * 通報を完了したドキュメントIDをローカル履歴に追加する。
 *
 * @param id - 通報対象のドキュメントID(`slug`)。
 */
export function addReportedDocumentId(id: string): void {
  if (typeof window === 'undefined' || !id || !SLUG_PATTERN.test(id)) {
    return;
  }

  try {
    const current = getReportedDocumentIds();
    const updated = [id, ...current.filter((item) => item !== id)].slice(
      0,
      MAX_REPORTED_STORED_COUNT,
    );
    window.localStorage.setItem(
      REPORTED_DOCUMENTS_STORAGE_KEY,
      JSON.stringify(updated),
    );
  } catch (error) {
    console.warn('localStorage への通報済みドキュメントID保存に失敗。', error);
  }
}
