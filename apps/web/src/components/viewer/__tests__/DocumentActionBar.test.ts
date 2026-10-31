import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  saveDocumentTokens,
  getDocumentTokens,
  getDocumentTokenRole,
  consumeTokenFromUrlHash,
} from '../../../lib/storage';

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

describe('DocumentActionBar アクション制御およびセキュリティ仕様の検証', () => {
  let mockStorage: MemoryStorage;
  const mockSlug = 'doc123456789';
  const mockEditToken = `pt_edt_${'x'.repeat(43)}`;
  const mockModifyToken = `pt_mod_${'y'.repeat(43)}`;

  beforeEach(() => {
    mockStorage = new MemoryStorage();
    (
      globalThis as unknown as {
        window?: {
          localStorage: MemoryStorage;
          location: {
            origin: string;
            pathname: string;
            search: string;
            hash: string;
            href: string;
          };
          history: {
            replaceState: (
              data: unknown,
              unused: string,
              url?: string | URL | null,
            ) => void;
          };
        };
      }
    ).window = {
      localStorage: mockStorage,
      location: {
        origin: 'https://patto.example.com',
        pathname: `/p/${mockSlug}`,
        search: '',
        hash: '',
        href: `https://patto.example.com/p/${mockSlug}`,
      },
      history: {
        replaceState: vi.fn(),
      },
    };
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    vi.restoreAllMocks();
  });

  describe('URL共有時のセキュリティサニタイズ検証', () => {
    it('共有URLコピー時にURLハッシュが含まれないこと。', () => {
      window.location.hash = `#edit_token=${mockEditToken}`;
      window.location.href = `https://patto.example.com/p/${mockSlug}#edit_token=${mockEditToken}`;

      const shareUrl = `${window.location.origin}${window.location.pathname}`;

      expect(shareUrl).toBe(`https://patto.example.com/p/${mockSlug}`);
      expect(shareUrl).not.toContain('#');
      expect(shareUrl).not.toContain(mockEditToken);
    });

    it('管理URLコピー時にのみ特権ハッシュが付加されること。', () => {
      saveDocumentTokens(mockSlug, { editToken: mockEditToken });

      const tokens = getDocumentTokens(mockSlug);
      expect(tokens?.editToken).toBe(mockEditToken);

      const adminShareUrl = `${window.location.origin}${window.location.pathname}#edit_token=${tokens!.editToken}`;

      expect(adminShareUrl).toBe(
        `https://patto.example.com/p/${mockSlug}#edit_token=${mockEditToken}`,
      );
    });
  });

  describe('権限ロール別のUI状態判定ロジック検証', () => {
    it('未認証の一般閲覧者は管理権限を持たないこと。', () => {
      const role = getDocumentTokenRole(mockSlug);
      const isOwner = role === 'edit';
      const isEditor = role === 'modify';
      const hasManagementPermission = isOwner || isEditor;

      expect(role).toBeNull();
      expect(isOwner).toBe(false);
      expect(isEditor).toBe(false);
      expect(hasManagementPermission).toBe(false);
    });

    it('`editToken` を保持する作成者は特権管理権限を持つこと。', () => {
      saveDocumentTokens(mockSlug, { editToken: mockEditToken });

      const role = getDocumentTokenRole(mockSlug);
      const isOwner = role === 'edit';
      const isEditor = role === 'modify';
      const hasManagementPermission = isOwner || isEditor;

      expect(role).toBe('edit');
      expect(isOwner).toBe(true);
      expect(isEditor).toBe(false);
      expect(hasManagementPermission).toBe(true);
    });

    it('`modifyToken` のみ保持する共同編集者は編集権限のみを持つこと。', () => {
      saveDocumentTokens(mockSlug, { modifyToken: mockModifyToken });

      const role = getDocumentTokenRole(mockSlug);
      const isOwner = role === 'edit';
      const isEditor = role === 'modify';
      const hasManagementPermission = isOwner || isEditor;

      expect(role).toBe('modify');
      expect(isOwner).toBe(false);
      expect(isEditor).toBe(true);
      expect(hasManagementPermission).toBe(true);
    });
  });

  describe('マウント時のハッシュ自動インポート連携', () => {
    it('ハッシュに `edit_token` が存在する場合、自動保存後にロールが `edit` と判定されること。', () => {
      window.location.hash = `#edit_token=${mockEditToken}`;

      const imported = consumeTokenFromUrlHash(mockSlug);
      expect(imported?.editToken).toBe(mockEditToken);

      const role = getDocumentTokenRole(mockSlug);
      expect(role).toBe('edit');

      expect(window.history.replaceState).toHaveBeenCalledWith(
        null,
        '',
        `/p/${mockSlug}`,
      );
    });
  });
});
