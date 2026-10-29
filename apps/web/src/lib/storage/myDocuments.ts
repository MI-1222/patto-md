/**
 * ブラウザの `localStorage` を用いた作成済みドキュメントID管理ユーティリティ。
 *
 * 匿名ユーザーが当ブラウザから公開したドキュメント履歴を追跡・保持する。
 */
import { SLUG_PATTERN } from '@patto-md/shared';

/** `localStorage` の保存キー名。 */
export const MY_DOCUMENTS_STORAGE_KEY = 'patto_md_my_document_ids';

/** 最大保持件数。 */
const MAX_STORED_COUNT = 100;

/**
 * 当ブラウザで公開したドキュメントID一覧を取得する。
 *
 * @returns ドキュメントID(`slug`)の配列。
 */
export function getMyDocumentIds(): string[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(MY_DOCUMENTS_STORAGE_KEY);
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
    console.warn('localStorage からのドキュメントID読み込みに失敗。', error);
    return [];
  }
}

/**
 * 新規公開したドキュメントIDをローカル履歴に追加する。
 *
 * @param id - 公開されたドキュメントのID(`slug`)。
 */
export function addMyDocumentId(id: string): void {
  if (typeof window === 'undefined' || !SLUG_PATTERN.test(id)) {
    return;
  }

  try {
    const current = getMyDocumentIds();
    const updated = [id, ...current.filter((item) => item !== id)].slice(
      0,
      MAX_STORED_COUNT,
    );
    window.localStorage.setItem(
      MY_DOCUMENTS_STORAGE_KEY,
      JSON.stringify(updated),
    );
  } catch (error) {
    console.warn('localStorage へのドキュメントID保存に失敗。', error);
  }
}

/**
 * 指定したドキュメントIDをローカル履歴から除外する。
 *
 * @param id - 除外対象のドキュメントID(`slug`)。
 */
export function removeMyDocumentId(id: string): void {
  if (typeof window === 'undefined' || !id) {
    return;
  }

  try {
    const current = getMyDocumentIds();
    const updated = current.filter((item) => item !== id);
    window.localStorage.setItem(
      MY_DOCUMENTS_STORAGE_KEY,
      JSON.stringify(updated),
    );
  } catch (error) {
    console.warn('localStorage からのドキュメントID削除に失敗。', error);
  }
}

/**
 * 指定されたドキュメントIDが当ブラウザで公開されたものか判定する。
 *
 * @param id - 判定対象のドキュメントID(`slug`)。
 * @returns 自身が作成したドキュメントであれば `true`、それ以外は `false`。
 */
export function isMyDocument(id: string): boolean {
  const ids = getMyDocumentIds();
  return ids.includes(id);
}
