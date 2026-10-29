import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getMyDocumentIds,
  addMyDocumentId,
  removeMyDocumentId,
  isMyDocument,
  MY_DOCUMENTS_STORAGE_KEY,
} from '../myDocuments';

/** インメモリの `localStorage` モック。 */
class MemoryStorage {
  private store: Map<string, string> = new Map();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

describe('自ブラウザ作成ドキュメント管理 (`myDocuments`)', () => {
  let mockStorage: MemoryStorage;

  beforeEach(() => {
    mockStorage = new MemoryStorage();
    (
      globalThis as unknown as { window?: { localStorage: MemoryStorage } }
    ).window = {
      localStorage: mockStorage,
    };
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it('初期状態では空配列を返却する。', () => {
    expect(getMyDocumentIds()).toEqual([]);
  });

  it('有効なドキュメントIDを正常に保存および取得できる。', () => {
    addMyDocumentId('abc123def456');
    expect(getMyDocumentIds()).toEqual(['abc123def456']);
    expect(isMyDocument('abc123def456')).toBe(true);
    expect(isMyDocument('other999slug')).toBe(false);
  });

  it('重複したIDを追加した場合、先頭に移動し重複を排除する。', () => {
    addMyDocumentId('first1234567');
    addMyDocumentId('second123456');
    addMyDocumentId('first1234567');

    expect(getMyDocumentIds()).toEqual(['first1234567', 'second123456']);
  });

  it('無効なSlug形式の文字列は追加されない。', () => {
    addMyDocumentId('invalid_short');
    addMyDocumentId('');
    expect(getMyDocumentIds()).toEqual([]);
  });

  it('不正なJSONが `localStorage` に存在しても安全に空配列を返却する。', () => {
    mockStorage.setItem(MY_DOCUMENTS_STORAGE_KEY, '{invalid json}');
    expect(getMyDocumentIds()).toEqual([]);
  });

  it('指定したIDを正常に削除できる。', () => {
    addMyDocumentId('slug11111111');
    addMyDocumentId('slug22222222');
    removeMyDocumentId('slug11111111');

    expect(getMyDocumentIds()).toEqual(['slug22222222']);
    expect(isMyDocument('slug11111111')).toBe(false);
  });
});
