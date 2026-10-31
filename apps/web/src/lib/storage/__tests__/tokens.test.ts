import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DOCUMENT_TOKENS_STORAGE_KEY,
  getDocumentTokens,
  saveDocumentTokens,
  removeDocumentTokens,
  getDocumentTokenRole,
  hasEditPermission,
  hasModifyPermission,
  clearStaleTokens,
  consumeTokenFromUrlHash,
  savePasscodeViewToken,
  getPasscodeViewToken,
  removePasscodeViewToken,
} from '../tokens.ts';
import { getMyDocumentIds } from '../myDocuments.ts';

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

describe('クライアント側トークン管理 (`tokens`)', () => {
  let mockStorage: MemoryStorage;
  let mockCookie = '';
  const validEditToken = `pt_edt_${'a'.repeat(43)}`;
  const validModifyToken = `pt_mod_${'b'.repeat(43)}`;
  const validSlug = 'abc123def456';

  beforeEach(() => {
    mockStorage = new MemoryStorage();
    mockCookie = '';
    (
      globalThis as unknown as {
        document?: { cookie: string };
        window?: {
          localStorage: MemoryStorage;
          location: {
            hash: string;
            pathname: string;
            search: string;
            protocol: string;
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
    ).document = {
      get cookie() {
        return mockCookie;
      },
      set cookie(val: string) {
        // 簡易 Cookie ストア実装
        const [cookiePair] = val.split(';');
        const [k, v] = cookiePair.split('=');
        if (val.includes('Max-Age=0')) {
          mockCookie = mockCookie
            .split(';')
            .filter((c) => !c.trim().startsWith(`${k}=`))
            .join(';');
        } else {
          mockCookie = `${mockCookie ? `${mockCookie}; ` : ''}${k}=${v}`;
        }
      },
    };
    (
      globalThis as unknown as {
        window?: {
          localStorage: MemoryStorage;
          location: {
            hash: string;
            pathname: string;
            search: string;
            protocol: string;
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
        hash: '',
        pathname: `/p/${validSlug}`,
        search: '',
        protocol: 'https:',
      },
      history: {
        replaceState: vi.fn(),
      },
    };
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    delete (globalThis as unknown as { document?: unknown }).document;
    vi.restoreAllMocks();
  });

  it('初期状態ではトークンが未保持(`null`)であること。', () => {
    expect(getDocumentTokens(validSlug)).toBeNull();
    expect(getDocumentTokenRole(validSlug)).toBeNull();
    expect(hasEditPermission(validSlug)).toBe(false);
    expect(hasModifyPermission(validSlug)).toBe(false);
  });

  it('有効な `editToken` / `modifyToken` を正常に保存および取得できること。', () => {
    saveDocumentTokens(validSlug, {
      editToken: validEditToken,
      modifyToken: validModifyToken,
    });

    const tokens = getDocumentTokens(validSlug);
    expect(tokens).not.toBeNull();
    expect(tokens?.editToken).toBe(validEditToken);
    expect(tokens?.modifyToken).toBe(validModifyToken);
    expect(tokens?.savedAt).toBeDefined();

    expect(getDocumentTokenRole(validSlug)).toBe('edit');
    expect(hasEditPermission(validSlug)).toBe(true);
    expect(hasModifyPermission(validSlug)).toBe(true);

    expect(getMyDocumentIds()).toContain(validSlug);
  });

  it('既存レコードが存在する場合、後から渡されたトークンとマージされること。', () => {
    saveDocumentTokens(validSlug, { modifyToken: validModifyToken });
    expect(getDocumentTokenRole(validSlug)).toBe('modify');
    expect(hasEditPermission(validSlug)).toBe(false);
    expect(hasModifyPermission(validSlug)).toBe(true);

    saveDocumentTokens(validSlug, { editToken: validEditToken });
    const merged = getDocumentTokens(validSlug);
    expect(merged?.editToken).toBe(validEditToken);
    expect(merged?.modifyToken).toBe(validModifyToken);
    expect(getDocumentTokenRole(validSlug)).toBe('edit');
  });

  it('無効な `slug` や無効なトークン形式は保存されないこと。', () => {
    saveDocumentTokens('invalid_short', { editToken: validEditToken });
    expect(getDocumentTokens('invalid_short')).toBeNull();

    saveDocumentTokens(validSlug, { editToken: 'invalid_token' });
    expect(getDocumentTokens(validSlug)).toBeNull();
  });

  it('指定したドキュメントのトークンを正常に破棄できること。', () => {
    saveDocumentTokens(validSlug, { editToken: validEditToken });
    expect(getDocumentTokens(validSlug)).not.toBeNull();

    removeDocumentTokens(validSlug);
    expect(getDocumentTokens(validSlug)).toBeNull();
    expect(getDocumentTokenRole(validSlug)).toBeNull();
  });

  it('`clearStaleTokens` で指定リスト外のトークンが一括消去されること。', () => {
    const slug1 = 'slug11111111';
    const slug2 = 'slug22222222';
    saveDocumentTokens(slug1, { editToken: validEditToken });
    saveDocumentTokens(slug2, { editToken: validEditToken });

    clearStaleTokens([slug1]);

    expect(getDocumentTokens(slug1)).not.toBeNull();
    expect(getDocumentTokens(slug2)).toBeNull();
  });

  it('最大保持件数(100件)を超過した場合、古いレコードが自動削除されること。', () => {
    const initialMap: Record<string, { editToken: string; savedAt: string }> =
      {};
    for (let i = 0; i < 100; i++) {
      const slug = `slug${i.toString().padStart(8, '0')}`;
      initialMap[slug] = {
        editToken: validEditToken,
        savedAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
      };
    }
    mockStorage.setItem(
      DOCUMENT_TOKENS_STORAGE_KEY,
      JSON.stringify(initialMap),
    );

    saveDocumentTokens('slugnew99999', { editToken: validEditToken });

    const raw = mockStorage.getItem(DOCUMENT_TOKENS_STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    const keys = Object.keys(parsed);
    expect(keys.length).toBe(100);
    expect(parsed['slug00000000']).toBeUndefined();
    expect(parsed['slugnew99999']).toBeDefined();
  });

  describe('`consumeTokenFromUrlHash` (URLハッシュ自動サニタイズ)', () => {
    it('`#edit_token=...` からトークンを取り込み、URLハッシュを除去すること。', () => {
      window.location.hash = `#edit_token=${validEditToken}`;

      const result = consumeTokenFromUrlHash(validSlug);
      expect(result).not.toBeNull();
      expect(result?.editToken).toBe(validEditToken);

      expect(getDocumentTokens(validSlug)?.editToken).toBe(validEditToken);

      expect(window.history.replaceState).toHaveBeenCalledWith(
        null,
        '',
        `/p/${validSlug}`,
      );
    });

    it('`#modify_token=...` からトークンを取り込めること。', () => {
      window.location.hash = `#modify_token=${validModifyToken}`;

      const result = consumeTokenFromUrlHash(validSlug);
      expect(result?.modifyToken).toBe(validModifyToken);
      expect(getDocumentTokenRole(validSlug)).toBe('modify');
    });

    it('不正なトークン形式のハッシュは無視され、消去も行われないこと。', () => {
      window.location.hash = '#edit_token=malicious_fake_token';

      const result = consumeTokenFromUrlHash(validSlug);
      expect(result).toBeNull();
      expect(getDocumentTokens(validSlug)).toBeNull();
      expect(window.history.replaceState).not.toHaveBeenCalled();
    });

    it('ハッシュが存在しない場合は `null` を返却すること。', () => {
      window.location.hash = '';
      const result = consumeTokenFromUrlHash(validSlug);
      expect(result).toBeNull();
    });
  });

  describe('パスコード閲覧トークン (`savePasscodeViewToken` / `getPasscodeViewToken` / `removePasscodeViewToken`)', () => {
    const dummyJwt = 'header.payload.signature';

    it('閲覧トークンを保存すると `Cookie` と `localStorage` の双方に反映されること。', () => {
      savePasscodeViewToken(validSlug, dummyJwt);

      // Cookie からの取得確認。
      expect(document.cookie).toContain(`patto_doc_auth_${validSlug}=`);
      expect(getPasscodeViewToken(validSlug)).toBe(dummyJwt);

      // localStorage 側の viewToken 保持確認。
      const stored = getDocumentTokens(validSlug);
      expect(stored?.viewToken).toBe(dummyJwt);
    });

    it('`Cookie` が存在しない場合でも `localStorage` からフォールバック取得できること。', () => {
      // localStorage への直接設定。
      mockStorage.setItem(
        DOCUMENT_TOKENS_STORAGE_KEY,
        JSON.stringify({
          [validSlug]: {
            viewToken: dummyJwt,
            savedAt: new Date().toISOString(),
          },
        }),
      );

      mockCookie = '';
      expect(getPasscodeViewToken(validSlug)).toBe(dummyJwt);
    });

    it('`removePasscodeViewToken` で `Cookie` と `localStorage` からクリアされること。', () => {
      savePasscodeViewToken(validSlug, dummyJwt);
      expect(getPasscodeViewToken(validSlug)).toBe(dummyJwt);

      removePasscodeViewToken(validSlug);
      expect(getPasscodeViewToken(validSlug)).toBeNull();
    });
  });
});
