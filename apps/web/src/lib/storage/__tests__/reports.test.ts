import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getReportedDocumentIds,
  isDocumentReported,
  addReportedDocumentId,
  REPORTED_DOCUMENTS_STORAGE_KEY,
} from '../reports';

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

describe('通報済みドキュメントID管理 (`reports`)', () => {
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

  it('初期状態では空配列を返却し、未通報と判定する。', () => {
    expect(getReportedDocumentIds()).toEqual([]);
    expect(isDocumentReported('abc123def456')).toBe(false);
  });

  it('通報済みドキュメントIDを保存し、判定できる。', () => {
    addReportedDocumentId('abc123def456');
    expect(getReportedDocumentIds()).toEqual(['abc123def456']);
    expect(isDocumentReported('abc123def456')).toBe(true);
    expect(isDocumentReported('other999slug')).toBe(false);
  });

  it('重複して同一IDを保存した場合、先頭に維持し重複を排除する。', () => {
    addReportedDocumentId('first1234567');
    addReportedDocumentId('second123456');
    addReportedDocumentId('first1234567');

    expect(getReportedDocumentIds()).toEqual(['first1234567', 'second123456']);
  });

  it('無効なSlug形式の文字列は追加されない。', () => {
    addReportedDocumentId('invalid');
    addReportedDocumentId('');
    expect(getReportedDocumentIds()).toEqual([]);
  });

  it('不正なJSONデータが存在する場合でも安全に空配列を返却する。', () => {
    mockStorage.setItem(REPORTED_DOCUMENTS_STORAGE_KEY, '{invalid json}');
    expect(getReportedDocumentIds()).toEqual([]);
  });
});
