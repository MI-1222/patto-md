import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanRelativePath,
  extractAndResolveAssets,
  extractTitle,
  isExternalOrInlineUrl,
  isSafePath,
  replaceMarkdownImageUrls,
} from '../src/lib/markdown.ts';

describe('Markdown 解析およびアセット抽出 (lib/markdown.ts)', () => {
  let tempDir: string;
  let markdownFile: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'patto-cli-md-test-'));
    markdownFile = path.join(tempDir, 'sample.md');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('extractTitle', () => {
    it('先頭のH1見出しからタイトルを抽出すること。', () => {
      const content = '# タイトルのテスト\n\n本文テキスト。';
      expect(extractTitle(content, markdownFile)).toBe('タイトルのテスト');
    });

    it('見出しがない場合、ファイル名からタイトルを抽出すること。', () => {
      const content = '本文のみのテキスト。';
      expect(extractTitle(content, markdownFile)).toBe('sample');
    });

    it('ファイル名も提供されない場合、Untitled を返すこと。', () => {
      const content = '本文のみのテキスト。';
      expect(extractTitle(content)).toBe('Untitled');
    });
  });

  describe('isExternalOrInlineUrl', () => {
    it('http, https, //, data: を外部またはインラインとして判定すること。', () => {
      expect(isExternalOrInlineUrl('https://example.com/img.png')).toBe(true);
      expect(isExternalOrInlineUrl('http://example.com/img.png')).toBe(true);
      expect(isExternalOrInlineUrl('//cdn.example.com/img.png')).toBe(true);
      expect(isExternalOrInlineUrl('data:image/png;base64,xxxx')).toBe(true);
      expect(isExternalOrInlineUrl('./images/local.png')).toBe(false);
      expect(isExternalOrInlineUrl('images/local.png')).toBe(false);
    });
  });

  describe('cleanRelativePath', () => {
    it('タイトル部分やクエリ、URLエンコードを正しくクリーンアップすること。', () => {
      expect(cleanRelativePath('images/sample.png "画像タイトル"')).toBe(
        'images/sample.png',
      );
      expect(cleanRelativePath('images/sample.png?v=123#anchor')).toBe(
        'images/sample.png',
      );
      expect(cleanRelativePath('images/my%20diagram.png')).toBe(
        'images/my diagram.png',
      );
    });
  });

  describe('isSafePath', () => {
    it('ベースディレクトリ配下の画像ファイルを安全と判定すること。', () => {
      const baseDir = tempDir;
      const target = path.join(baseDir, 'images', 'arch.png');
      expect(isSafePath(target, baseDir)).toBe(true);
    });

    it('画像以外の拡張子を拒絶すること。', () => {
      const baseDir = tempDir;
      const target = path.join(baseDir, 'secret.env');
      expect(isSafePath(target, baseDir)).toBe(false);
    });
  });

  describe('extractAndResolveAssets', () => {
    it('相対パス画像を検出し、ローカルファイルを正しく読み込むこと。', async () => {
      const imgDir = path.join(tempDir, 'images');
      await fs.mkdir(imgDir, { recursive: true });
      const img1Path = path.join(imgDir, 'figure1.png');
      const img2Path = path.join(tempDir, 'diagram.webp');

      await fs.writeFile(img1Path, Buffer.from('fake-png-content'));
      await fs.writeFile(img2Path, Buffer.from('fake-webp-content'));

      const mdContent = `
# システム概要

![図1](./images/figure1.png "キャプション")
<img src="diagram.webp" width="500" />
![外部画像](https://example.com/remote.png)
`;

      const result = await extractAndResolveAssets(mdContent, markdownFile);

      expect(result.missingPaths).toHaveLength(0);
      expect(result.invalidPaths).toHaveLength(0);
      expect(result.assets).toHaveLength(2);

      const fileNames = result.assets.map((a) => a.fileName);
      expect(fileNames).toContain('figure1.png');
      expect(fileNames).toContain('diagram.webp');
    });

    it('存在しない画像ファイルを missingPaths に記録すること。', async () => {
      const mdContent = '![存在しない画像](./missing.png)';
      const result = await extractAndResolveAssets(mdContent, markdownFile);

      expect(result.assets).toHaveLength(0);
      expect(result.missingPaths).toContain('./missing.png');
    });

    it('同一実体ファイルへの複数参照(./img.png と img.png)をユニーク化し重複排除すること。', async () => {
      const imgPath = path.join(tempDir, 'photo.png');
      await fs.writeFile(imgPath, Buffer.from('fake-photo-content'));

      const mdContent = `
# 重複参照テスト

![1回目の参照](./photo.png)
<img src="photo.png" />
![3回目の参照](./photo.png "タイトル付き")
`;

      const result = await extractAndResolveAssets(mdContent, markdownFile);

      // 実体ファイルとしては1件のみ登録されること
      expect(result.assets).toHaveLength(1);
      const asset = result.assets[0];
      expect(asset).toBeDefined();
      expect(asset?.fileName).toBe('photo.png');
      // originalPaths に重複せずすべての参照表記が含まれていること
      expect(asset?.originalPaths).toContain('./photo.png');
      expect(asset?.originalPaths).toContain('photo.png');
    });
  });

  describe('replaceMarkdownImageUrls', () => {
    it('元の相対画像パスを永続アセットURLに一括置換すること。', () => {
      const mdContent = `
![図1](./images/fig1.png)
<img src="images/fig2.webp" />
`;

      const mapping = new Map<string, string>([
        ['./images/fig1.png', '/api/assets/exp-7d/fig1.png'],
        ['images/fig2.webp', '/api/assets/exp-7d/fig2.webp'],
      ]);

      const replaced = replaceMarkdownImageUrls(mdContent, mapping);
      expect(replaced).toContain('![図1](/api/assets/exp-7d/fig1.png)');
      expect(replaced).toContain('<img src="/api/assets/exp-7d/fig2.webp" />');
    });

    it('本文中の平文テキストに同名ファイル名が含まれていても置換しないこと(誤爆防止)。', () => {
      const mdContent = `
# レポート

![図1](./images/fig1.png)

補足説明: 本ドキュメントの詳細は ./images/fig1.png を参照してください。
また fig1.png の更新予定はありません。
`;

      const mapping = new Map<string, string>([
        ['./images/fig1.png', '/api/assets/exp-7d/fig1.png'],
      ]);

      const replaced = replaceMarkdownImageUrls(mdContent, mapping);

      // 画像記法のみ置換されること
      expect(replaced).toContain('![図1](/api/assets/exp-7d/fig1.png)');
      // 平文テキストはそのまま保持されること
      expect(replaced).toContain(
        '補足説明: 本ドキュメントの詳細は ./images/fig1.png を参照してください。',
      );
      expect(replaced).toContain('また fig1.png の更新予定はありません。');
    });

    it('img.png と sub/img.png が混在する場合でも多重置換が発生しないこと(部分一致干渉防止)。', () => {
      const mdContent = `
![浅い階層](img.png)
![深い階層](sub/img.png)
`;

      const mapping = new Map<string, string>([
        ['img.png', '/api/assets/exp-7d/img.png'],
        ['sub/img.png', '/api/assets/exp-7d/sub_img.png'],
      ]);

      const replaced = replaceMarkdownImageUrls(mdContent, mapping);

      expect(replaced).toContain('![浅い階層](/api/assets/exp-7d/img.png)');
      expect(replaced).toContain('![深い階層](/api/assets/exp-7d/sub_img.png)');
      // 不正な多重置換 (sub//api/assets/...) が発生していないこと
      expect(replaced).not.toContain('sub//api/assets/');
    });

    it('タイトル付きMarkdown画像記法でもタイトルを保持して置換できること。', () => {
      const mdContent = '![図1](./figure.png "画像のキャプション")';
      const mapping = new Map<string, string>([
        ['./figure.png', '/api/assets/exp-7d/figure.png'],
      ]);

      const replaced = replaceMarkdownImageUrls(mdContent, mapping);
      expect(replaced).toBe(
        '![図1](/api/assets/exp-7d/figure.png "画像のキャプション")',
      );
    });
  });
});
