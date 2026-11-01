import { describe, expect, it } from 'vitest';
import {
  appendCacheBuster,
  cleanDescription,
  DEFAULT_DOCUMENT_DESCRIPTION,
  DEFAULT_OGP_IMAGE_PATH,
  extractFirstImageUrl,
  isSupportedAttachmentImage,
  isSupportedOgpImageUrl,
  MASKED_OGP_DESCRIPTION,
  MASKED_OGP_TITLE,
  resolveDocumentOgp,
  toAbsoluteUrl,
} from '../extract';
import type { OgpDocumentSource, ResolveOgpOptions } from '../types';

describe('OGP 画像URLのサポート判定 (`isSupportedOgpImageUrl`)', () => {
  it('デフォルトのOGP画像パスが `/ogp.jpeg` であること。', () => {
    expect(DEFAULT_OGP_IMAGE_PATH).toBe('/ogp.jpeg');
  });

  it('JPEG, PNG, WebP, GIFなどのラスター画像URLを許可すること。', () => {
    expect(isSupportedOgpImageUrl('https://example.com/image.jpg')).toBe(true);
    expect(isSupportedOgpImageUrl('https://example.com/image.png')).toBe(true);
    expect(isSupportedOgpImageUrl('https://example.com/image.webp')).toBe(true);
    expect(isSupportedOgpImageUrl('https://example.com/image.gif')).toBe(true);
    expect(isSupportedOgpImageUrl('/api/assets/temp/uploads/pic.jpeg')).toBe(
      true,
    );
  });

  it('SVG形式の画像URLを除外すること。', () => {
    expect(isSupportedOgpImageUrl('https://example.com/icon.svg')).toBe(false);
    expect(isSupportedOgpImageUrl('https://example.com/icon.SVG')).toBe(false);
    expect(isSupportedOgpImageUrl('https://example.com/icon.svg?v=123')).toBe(
      false,
    );
    expect(isSupportedOgpImageUrl('/api/assets/vector.svg#hash')).toBe(false);
  });

  it('Data URI や Blob URL を除外すること。', () => {
    expect(
      isSupportedOgpImageUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...'),
    ).toBe(false);
    expect(isSupportedOgpImageUrl('blob:https://example.com/uuid-here')).toBe(
      false,
    );
  });

  it('未指定や空文字の場合は除外すること。', () => {
    expect(isSupportedOgpImageUrl('')).toBe(false);
    expect(isSupportedOgpImageUrl('   ')).toBe(false);
    expect(isSupportedOgpImageUrl(null)).toBe(false);
    expect(isSupportedOgpImageUrl(undefined)).toBe(false);
  });
});

describe('添付ファイルのOGPサポート判定 (`isSupportedAttachmentImage`)', () => {
  it('画像MIMEタイプの添付ファイルを許可すること。', () => {
    expect(
      isSupportedAttachmentImage({
        r2Key: 'key-1',
        mimeType: 'image/png',
        fileName: 'test.png',
      }),
    ).toBe(true);
  });

  it('SVGの添付ファイルを除外すること。', () => {
    expect(
      isSupportedAttachmentImage({
        r2Key: 'key-svg',
        mimeType: 'image/svg+xml',
        fileName: 'icon.svg',
      }),
    ).toBe(false);
    expect(
      isSupportedAttachmentImage({
        r2Key: 'key-svg-2',
        fileName: 'diagram.svg',
      }),
    ).toBe(false);
  });

  it('R2キーがない無効なオブジェクトを除外すること。', () => {
    expect(
      isSupportedAttachmentImage({
        r2Key: '',
        mimeType: 'image/png',
      }),
    ).toBe(false);
  });
});

describe('先頭画像抽出処理 (`extractFirstImageUrl`)', () => {
  it('Markdown本文内の先頭画像構文を抽出できること。', () => {
    const md = `
# 見出し
本文テキストです。
![テスト画像](https://example.com/photo.jpg)
2枚目の画像: ![2枚目](/api/assets/photo2.webp)
`;
    expect(extractFirstImageUrl(md)).toBe('https://example.com/photo.jpg');
  });

  it('タイトル付きMarkdown画像構文からURLを抽出できること。', () => {
    const md = '![キャプション](https://example.com/banner.png "バナー画像")';
    expect(extractFirstImageUrl(md)).toBe('https://example.com/banner.png');
  });

  it('HTML `<img>` タグから先頭画像を抽出できること。', () => {
    const md = `
<p>テキスト</p>
<img src="https://example.com/header.webp" alt="ヘッダー" width="800" />
`;
    expect(extractFirstImageUrl(md)).toBe('https://example.com/header.webp');
  });

  it('先頭画像がSVGの場合はスキップし、後続のラスター画像を抽出すること。', () => {
    const md = `
![SVGアイコン](/icons/logo.svg)
![ラスター写真](https://example.com/photo.jpg)
`;
    expect(extractFirstImageUrl(md)).toBe('https://example.com/photo.jpg');
  });

  it('本文に画像がない場合、添付ファイル一覧から先頭ラスター画像を抽出すること。', () => {
    const md = '# 画像のないMarkdown本文';
    const attachments = [
      { r2Key: 'icon.svg', mimeType: 'image/svg+xml' },
      { r2Key: 'exp-7d/uploads/hero.webp', mimeType: 'image/webp' },
    ];
    expect(extractFirstImageUrl(md, attachments)).toBe(
      '/api/assets/exp-7d/uploads/hero.webp',
    );
  });

  it('本文および添付ファイルに画像が存在しない場合は `null` を返却すること。', () => {
    const md = '# テキストのみの本文';
    expect(extractFirstImageUrl(md, [])).toBeNull();
    expect(extractFirstImageUrl(null, undefined)).toBeNull();
  });
});

describe('説明文の抽出・サニタイズ (`cleanDescription`)', () => {
  it('明示的な要約テキストがある場合はそれを最優先すること。', () => {
    const result = cleanDescription('明示的な要約です。', '# 本文');
    expect(result).toBe('明示的な要約です。');
  });

  it('改行コードを単一の空白文字へ平坦化すること。', () => {
    const raw = '1行目のテキスト。\n2行目のテキスト。\r\n3行目。';
    expect(cleanDescription(raw)).toBe(
      '1行目のテキスト。 2行目のテキスト。 3行目。',
    );
  });

  it('120文字を超過する場合は三点リーダーで切り詰めること。', () => {
    const longText = 'あ'.repeat(150);
    const result = cleanDescription(longText);
    expect(result.length).toBe(123);
    expect(result.endsWith('...')).toBe(true);
  });

  it('要約未指定時は本文Markdownから装飾記号を除去して抽出すること。', () => {
    const md = `
# 大見出し
これは **太字** と *斜体*、そして \`インラインコード\` を含む [リンク](https://example.com) です。
`;
    const result = cleanDescription(null, md);
    expect(result).toContain(
      'これは 太字 と 斜体、そして インラインコード を含む リンク です。',
    );
    expect(result).not.toContain('#');
    expect(result).not.toContain('**');
  });

  it('本文も空の場合はデフォルト説明文を返却すること。', () => {
    expect(cleanDescription(null, '')).toBe(DEFAULT_DOCUMENT_DESCRIPTION);
  });
});

describe('絶対URL変換処理 (`toAbsoluteUrl`)', () => {
  it('すでにスキーマを含む完全修飾URLはそのまま返却すること。', () => {
    expect(
      toAbsoluteUrl('https://example.com/ogp.jpg', 'http://localhost:4321'),
    ).toBe('https://example.com/ogp.jpg');
  });

  it('相対パスを完全修飾URLへ変換すること。', () => {
    expect(toAbsoluteUrl('/api/assets/pic.webp', 'https://patto.md')).toBe(
      'https://patto.md/api/assets/pic.webp',
    );
  });
});

describe('キャッシュバスター付与処理 (`appendCacheBuster`)', () => {
  it('有効な更新日時がある場合、クエリパラメータ `?v=...` を付与すること。', () => {
    const url = 'https://patto.md/api/assets/image.webp';
    const updatedAt = '2026-11-01T12:00:00.000Z';
    const timestamp = new Date(updatedAt).getTime();
    expect(appendCacheBuster(url, updatedAt)).toBe(
      `https://patto.md/api/assets/image.webp?v=${timestamp}`,
    );
  });

  it('すでにクエリパラメータが存在する場合、`&v=...` で結合すること。', () => {
    const url = 'https://patto.md/api/assets/image.webp?w=800';
    const updatedAt = '2026-11-01T12:00:00.000Z';
    const timestamp = new Date(updatedAt).getTime();
    expect(appendCacheBuster(url, updatedAt)).toBe(
      `https://patto.md/api/assets/image.webp?w=800&v=${timestamp}`,
    );
  });

  it('更新日時が無効または未指定の場合はURLを変更しないこと。', () => {
    const url = 'https://patto.md/ogp.jpeg';
    expect(appendCacheBuster(url, undefined)).toBe(url);
    expect(appendCacheBuster(url, 'invalid-date')).toBe(url);
  });
});

describe('ドキュメントOGP総合解決処理 (`resolveDocumentOgp`)', () => {
  const defaultOptions: ResolveOgpOptions = {
    currentUrl: 'https://patto.md/p/abc123xyz789?view=raw#L15-L30',
    assetBaseUrl: 'https://api.patto.md',
    defaultImagePath: '/ogp.jpeg',
  };

  it('通常公開ドキュメント (固有画像あり) で `summary_large_image` を設定すること。', () => {
    const doc: OgpDocumentSource = {
      id: 'abc123xyz789',
      title: 'テストドキュメント',
      description: 'テストの要約文。',
      content: '# テキスト\n![サンプル](/api/assets/exp-7d/photo.png)',
      visibility: 'public',
      isProtected: false,
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T11:00:00.000Z',
      attachments: [],
    };

    const ogp = resolveDocumentOgp(doc, defaultOptions);

    expect(ogp.title).toBe('テストドキュメント - patto-md');
    expect(ogp.description).toBe('テストの要約文。');
    expect(ogp.cardType).toBe('summary_large_image');
    expect(ogp.noindex).toBe(false);
    expect(ogp.ogType).toBe('article');
    expect(ogp.canonicalUrl).toBe('https://patto.md/p/abc123xyz789');
    expect(ogp.imageUrl).toContain(
      'https://api.patto.md/api/assets/exp-7d/photo.png?v=',
    );
    expect(ogp.publishedTime).toBe('2026-11-01T10:00:00.000Z');
    expect(ogp.modifiedTime).toBe('2026-11-01T11:00:00.000Z');
  });

  it('固有画像がない場合はデフォルトOGP画像と `summary` カード種別を適用すること。', () => {
    const doc: OgpDocumentSource = {
      id: 'abc123xyz789',
      title: '画像なしドキュメント',
      content: 'プレーンな本文です。',
      visibility: 'public',
      isProtected: false,
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T11:00:00.000Z',
    };

    const ogp = resolveDocumentOgp(doc, defaultOptions);

    expect(ogp.cardType).toBe('summary');
    expect(ogp.imageUrl).toBe('https://patto.md/ogp.jpeg');
    expect(ogp.imageUrl).not.toContain('?v=');
  });

  it('限定公開 (`unlisted`) の場合、`noindex` を `true` に設定すること。', () => {
    const doc: OgpDocumentSource = {
      id: 'abc123xyz789',
      title: '限定公開ドキュメント',
      visibility: 'unlisted',
      isProtected: false,
    };

    const ogp = resolveDocumentOgp(doc, defaultOptions);
    expect(ogp.noindex).toBe(true);
    expect(ogp.title).toBe('限定公開ドキュメント - patto-md');
  });

  it('パスコード保護ドキュメントの場合、タイトルと説明文を完全にマスキングし `noindex` を強制すること。', () => {
    const doc: OgpDocumentSource = {
      id: 'secret123456',
      title: '極秘の機密タイトル',
      description: '機密の要約文章。',
      content: '機密の本文実体。![極秘写真](/api/assets/secret.jpg)',
      isProtected: true,
      visibility: 'protected',
      attachments: [{ r2Key: 'secret.jpg', mimeType: 'image/jpeg' }],
    };

    const ogp = resolveDocumentOgp(doc, defaultOptions);

    expect(ogp.title).toBe(MASKED_OGP_TITLE);
    expect(ogp.title).not.toContain('極秘');
    expect(ogp.description).toBe(MASKED_OGP_DESCRIPTION);
    expect(ogp.description).not.toContain('機密');
    expect(ogp.imageUrl).toBe('https://patto.md/ogp.jpeg');
    expect(ogp.imageUrl).not.toContain('secret.jpg');
    expect(ogp.cardType).toBe('summary');
    expect(ogp.noindex).toBe(true);
    expect(ogp.canonicalUrl).toBe('https://patto.md/p/secret123456');
    expect(ogp.ogType).toBe('article');
  });

  it("認証済みセッション等で `isProtected` が `false` の場合でも、`visibility === 'protected'` であれば多重防御としてマスキングされること。", () => {
    const doc: OgpDocumentSource = {
      id: 'secret123456',
      title: '認証解除後の機密タイトル',
      description: '認証解除後の本文抜粋。',
      content: '本文実体。![写真](/api/assets/photo.jpg)',
      isProtected: false,
      visibility: 'protected',
      attachments: [{ r2Key: 'photo.jpg', mimeType: 'image/jpeg' }],
    };

    const ogp = resolveDocumentOgp(doc, defaultOptions);

    expect(ogp.title).toBe(MASKED_OGP_TITLE);
    expect(ogp.description).toBe(MASKED_OGP_DESCRIPTION);
    expect(ogp.imageUrl).toBe('https://patto.md/ogp.jpeg');
    expect(ogp.cardType).toBe('summary');
    expect(ogp.noindex).toBe(true);
  });
});
