import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../parser';
import { normalizeRelativePath, isExternalUrl } from '../path';

describe('Markdown AST解析パイプライン', () => {
  describe('isExternalUrl', () => {
    it('外部HTTP/HTTPS URLおよびプロトコル相対URLを正しく判定すること', () => {
      expect(isExternalUrl('https://example.com/image.png')).toBe(true);
      expect(isExternalUrl('http://example.com/image.png')).toBe(true);
      expect(isExternalUrl('//example.com/image.png')).toBe(true);
    });

    it('Data URIおよびBlob URLを外部リソースとして判定すること', () => {
      expect(isExternalUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
      expect(isExternalUrl('blob:https://example.com/uuid')).toBe(true);
    });

    it('ローカル相対パスを外部URLと判定しないこと', () => {
      expect(isExternalUrl('./images/photo.png')).toBe(false);
      expect(isExternalUrl('images/photo.png')).toBe(false);
      expect(isExternalUrl('../assets/icon.svg')).toBe(false);
      expect(isExternalUrl('/assets/icon.svg')).toBe(false);
    });
  });

  describe('normalizeRelativePath', () => {
    it('Windowsセパレータと先頭のドットスラッシュを正規化すること', () => {
      const { cleanPath } = normalizeRelativePath('.\\images\\sub\\photo.png');
      expect(cleanPath).toBe('images/sub/photo.png');
    });

    it('URLエンコードされたファイル名をデコードすること', () => {
      const { cleanPath } = normalizeRelativePath('images/%E5%9B%B31.png');
      expect(cleanPath).toBe('images/図1.png');
    });

    it('クエリパラメータとハッシュフラグメントを分離すること', () => {
      const { cleanPath, queryParams } = normalizeRelativePath(
        './assets/diagram.png?raw=true#center',
      );
      expect(cleanPath).toBe('assets/diagram.png');
      expect(queryParams).toBe('?raw=true#center');
    });

    it('Markdown配置ディレクトリを基準に相対パスを解決すること', () => {
      const { cleanPath } = normalizeRelativePath(
        './images/arch.png',
        'docs/sub/readme.md',
      );
      expect(cleanPath).toBe('docs/sub/images/arch.png');
    });

    it('先頭スラッシュで始まるルート相対パスの場合はbaseDirを無視してルート直下として解決すること', () => {
      const { cleanPath } = normalizeRelativePath(
        '/assets/img.png',
        'docs/sub/readme.md',
      );
      expect(cleanPath).toBe('assets/img.png');
    });

    it('相対親階層(..)を解決し、ルート外脱出を防止すること', () => {
      const { cleanPath } = normalizeRelativePath(
        '../images/arch.png',
        'docs/sub/readme.md',
      );
      expect(cleanPath).toBe('docs/images/arch.png');

      const traversal = normalizeRelativePath('../../../outside.png', 'doc.md');
      expect(traversal.cleanPath).toBe('outside.png');
    });
  });

  describe('parseMarkdown', () => {
    it('Markdown内のローカル画像を抽出し外部画像を除外すること', async () => {
      const markdown = `
# サンプルドキュメント

ローカル画像:
![ローカル画像1](./images/foo.png)
![ローカル画像2](images/bar.jpg?v=2)

外部画像:
![外部画像](https://example.com/ext.png)
![Data画像](data:image/png;base64,AAA)
`;

      const result = await parseMarkdown(markdown);

      expect(result.title).toBe('サンプルドキュメント');
      expect(result.externalImageCount).toBe(2);
      expect(result.imageRefs).toHaveLength(2);
      expect(result.imageRefs[0].cleanPath).toBe('images/foo.png');
      expect(result.imageRefs[0].alt).toBe('ローカル画像1');
      expect(result.imageRefs[1].cleanPath).toBe('images/bar.jpg');
      expect(result.imageRefs[1].queryParams).toBe('?v=2');
      expect(result.uniqueAssetPaths).toEqual([
        'images/foo.png',
        'images/bar.jpg',
      ]);
    });

    it('コードブロックやインラインコード内の画像記法を無視すること', async () => {
      const markdown = `
# コードブロックテスト

\`\`\`markdown
![偽画像1](./fake/code-block.png)
\`\`\`

インラインコード: \`![偽画像2](./fake/inline.png)\`

本物の画像:
![実画像](./real/image.png)
`;

      const result = await parseMarkdown(markdown);

      expect(result.imageRefs).toHaveLength(1);
      expect(result.imageRefs[0].cleanPath).toBe('real/image.png');
    });

    it('参照リンク形式の画像(![alt][ref])を抽出できること', async () => {
      const markdown = `
# 参照リンク形式

![システム構成図][fig1]

[fig1]: ./assets/architecture.png "全体構成図"
`;

      const result = await parseMarkdown(markdown);

      expect(result.imageRefs).toHaveLength(1);
      expect(result.imageRefs[0].cleanPath).toBe('assets/architecture.png');
      expect(result.imageRefs[0].title).toBe('全体構成図');
    });

    it('同一の参照リンクが複数箇所で使用されている場合、登場箇所ごとに抽出されつつuniqueAssetPathsが重複排除されること', async () => {
      const markdown = `
# 複数参照テスト

上部図面: ![図面1][fig]
下部図面: ![図面2][fig]

[fig]: ./assets/diagram.png "共通図面"
`;

      const result = await parseMarkdown(markdown);

      expect(result.imageRefs).toHaveLength(2);
      expect(result.imageRefs[0].alt).toBe('図面1');
      expect(result.imageRefs[1].alt).toBe('図面2');
      expect(result.imageRefs[0].cleanPath).toBe('assets/diagram.png');
      expect(result.imageRefs[1].cleanPath).toBe('assets/diagram.png');
      expect(result.uniqueAssetPaths).toEqual(['assets/diagram.png']);
    });

    it('GFM拡張テーブル内の画像を抽出できること', async () => {
      const markdown = `
| 項目 | スクリーンショット |
| --- | --- |
| 機能A | ![A](./assets/feature-a.png) |
| 機能B | ![B](./assets/feature-b.png) |
`;

      const result = await parseMarkdown(markdown);

      expect(result.imageRefs).toHaveLength(2);
      expect(result.uniqueAssetPaths).toEqual([
        'assets/feature-a.png',
        'assets/feature-b.png',
      ]);
    });

    it('H1見出しがない場合にfallbackTitleを使用すること', async () => {
      const markdown = `
## H2見出しのみ

![画像](./img.png)
`;

      const result = await parseMarkdown(markdown, {
        fallbackTitle: '無題のドキュメント',
      });

      expect(result.title).toBe('無題のドキュメント');
      expect(result.imageRefs).toHaveLength(1);
    });

    it('空文字列や異常な入力でもクラッシュしないこと', async () => {
      const result = await parseMarkdown('', {
        fallbackTitle: '空ドキュメント',
      });

      expect(result.title).toBe('空ドキュメント');
      expect(result.imageRefs).toHaveLength(0);
      expect(result.uniqueAssetPaths).toHaveLength(0);
    });
  });
});
