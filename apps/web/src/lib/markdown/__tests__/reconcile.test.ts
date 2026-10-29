import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../parser';
import {
  reconcileAssets,
  cloneAstWithPreviewUrls,
  replaceMarkdownImageUrls,
} from '../reconcile';
import type { VirtualFile } from '../../../components/dropzone/types';

/** テスト用ダミー `File` オブジェクト生成ヘルパー。 */
function createDummyFile(name: string, content = 'dummy'): File {
  return new File([content], name, { type: 'image/png' });
}

/** テスト用 `VirtualFile` 生成ヘルパー。 */
function createVirtualFile(relativePath: string, file?: File): VirtualFile {
  const fileName = relativePath.split('/').pop() || 'test.png';
  return {
    file: file || createDummyFile(fileName),
    relativePath,
    isSizeExceeded: false,
    isTypeUnsupported: false,
  };
}

describe('reconcileAssets (仮想ファイルマップ突合エンジン)', () => {
  it('完全相対パス一致で正常に解決できること', async () => {
    const md = '![アーキテクチャ](images/arch.png)';
    const parsed = await parseMarkdown(md);

    const assetFiles = new Map<string, VirtualFile>([
      ['images/arch.png', createVirtualFile('images/arch.png')],
    ]);

    const result = reconcileAssets(parsed.imageRefs, assetFiles);

    expect(result.isComplete).toBe(true);
    expect(result.resolved.size).toBe(1);
    expect(result.missing.length).toBe(0);
    expect(result.unused.length).toBe(0);

    const resolved = result.resolved.get('images/arch.png')!;
    expect(resolved).toBeDefined();
    expect(resolved.matchType).toBe('exact');
    expect(resolved.relativePath).toBe('images/arch.png');
  });

  it('末尾サフィックス一致でルートフォルダ名差異を吸収して解決できること', async () => {
    const md = '![図](assets/diagram.png)';
    const parsed = await parseMarkdown(md);

    // ドロップされたファイル側にルートフォルダ名が付いている場合。
    const assetFiles = new Map<string, VirtualFile>([
      [
        'my-project/assets/diagram.png',
        createVirtualFile('my-project/assets/diagram.png'),
      ],
    ]);

    const result = reconcileAssets(parsed.imageRefs, assetFiles);

    expect(result.isComplete).toBe(true);
    expect(result.resolved.size).toBe(1);
    const resolved = result.resolved.get('assets/diagram.png')!;
    expect(resolved.matchType).toBe('suffix');
    expect(resolved.relativePath).toBe('my-project/assets/diagram.png');
  });

  it('大文字・小文字の差異(Case-insensitive)を吸収して解決できること', async () => {
    const md = '![スクリーンショット](images/SCREENSHOT.PNG)';
    const parsed = await parseMarkdown(md);

    const assetFiles = new Map<string, VirtualFile>([
      ['images/screenshot.png', createVirtualFile('images/screenshot.png')],
    ]);

    const result = reconcileAssets(parsed.imageRefs, assetFiles);

    expect(result.isComplete).toBe(true);
    const resolved = result.resolved.get('images/SCREENSHOT.PNG')!;
    expect(resolved.matchType).toBe('case-insensitive');
    expect(resolved.relativePath).toBe('images/screenshot.png');
  });

  it('バラドロップ時にファイル名単体(basename)フォールバックで解決できること', async () => {
    const md = '![図面](./sub/deep/path/figure1.png)';
    const parsed = await parseMarkdown(md);

    // バラドロップされたため相対パスがファイル名単体になっている。
    const assetFiles = new Map<string, VirtualFile>([
      ['figure1.png', createVirtualFile('figure1.png')],
    ]);

    const result = reconcileAssets(parsed.imageRefs, assetFiles);

    expect(result.isComplete).toBe(true);
    const resolved = result.resolved.get('sub/deep/path/figure1.png')!;
    expect(resolved.matchType).toBe('basename');
    expect(resolved.relativePath).toBe('figure1.png');
  });

  it('同名のファイルが複数存在する場合は誤突合を防ぎ曖昧として未解決にすること', async () => {
    const md = '![グラフ](assets/chart.png)';
    const parsed = await parseMarkdown(md);

    // 別ディレクトリに同名ファイルが2つ存在する場合。
    const assetFiles = new Map<string, VirtualFile>([
      ['dirA/chart.png', createVirtualFile('dirA/chart.png')],
      ['dirB/chart.png', createVirtualFile('dirB/chart.png')],
    ]);

    const result = reconcileAssets(parsed.imageRefs, assetFiles);

    expect(result.isComplete).toBe(false);
    expect(result.resolved.size).toBe(0);
    expect(result.missing.length).toBe(1);

    const missing = result.missing[0];
    expect(missing.cleanPath).toBe('assets/chart.png');
    expect(missing.reason).toBe('ambiguous_basename');
    expect(missing.candidatePaths).toEqual([
      'dirA/chart.png',
      'dirB/chart.png',
    ]);
  });

  it('ファイルが存在しない場合はnot_foundとして未解決にすること', async () => {
    const md = '![見つからない](missing.png)';
    const parsed = await parseMarkdown(md);

    const assetFiles = new Map<string, VirtualFile>();
    const result = reconcileAssets(parsed.imageRefs, assetFiles);

    expect(result.isComplete).toBe(false);
    expect(result.missing.length).toBe(1);
    expect(result.missing[0].cleanPath).toBe('missing.png');
    expect(result.missing[0].reason).toBe('not_found');
  });

  it('macOSのNFD濁点とMarkdownテキストのNFC濁点を正規化して一致させること', async () => {
    // 'ホ' + 結合濁点 (`NFD`)
    const nfdName = 'images/ホ\u3099タン.png';
    // 'ボ' (`NFC`)
    const nfcPathInMd = 'images/ボタン.png';

    const md = `![ボタン](${nfcPathInMd})`;
    const parsed = await parseMarkdown(md);

    const assetFiles = new Map<string, VirtualFile>([
      [nfdName, createVirtualFile(nfdName)],
    ]);

    const result = reconcileAssets(parsed.imageRefs, assetFiles);

    expect(result.isComplete).toBe(true);
    expect(result.resolved.size).toBe(1);
  });

  it('同一画像が複数回参照された場合でも漏れなく全参照ノードを紐付けること', async () => {
    const md = `
# タイトル
![1回目](shared.png)
本文テキスト。
![2回目](shared.png)
`;
    const parsed = await parseMarkdown(md);

    const assetFiles = new Map<string, VirtualFile>([
      ['shared.png', createVirtualFile('shared.png')],
    ]);

    const result = reconcileAssets(parsed.imageRefs, assetFiles);

    expect(result.isComplete).toBe(true);
    expect(result.totalRefsCount).toBe(2);
    expect(result.totalResolvedCount).toBe(1);

    const resolved = result.resolved.get('shared.png')!;
    expect(resolved.refs.length).toBe(2);
  });

  it('Markdownで参照されていない画像は余剰(unused)として分類すること', async () => {
    const md = '![必要](needed.png)';
    const parsed = await parseMarkdown(md);

    const assetFiles = new Map<string, VirtualFile>([
      ['needed.png', createVirtualFile('needed.png')],
      ['unused1.png', createVirtualFile('unused1.png')],
      ['unused2.jpg', createVirtualFile('unused2.jpg')],
    ]);

    const result = reconcileAssets(parsed.imageRefs, assetFiles);

    expect(result.isComplete).toBe(true);
    expect(result.resolved.size).toBe(1);
    expect(result.unused.length).toBe(2);
    expect(result.unused.map((u) => u.relativePath)).toEqual([
      'unused1.png',
      'unused2.jpg',
    ]);
  });
});

describe('cloneAstWithPreviewUrls (ASTプレビュー用URL置換)', () => {
  it('原本ASTを破壊せずにプレビュー用URLに置換したクローンASTを生成すること', async () => {
    const md = '![テスト](images/sample.png?v=1)';
    const parsed = await parseMarkdown(md);

    const previewUrlMap = new Map<string, string>([
      ['images/sample.png', 'blob:http://localhost:3000/preview-uuid-1'],
    ]);

    const previewAst = cloneAstWithPreviewUrls(parsed.ast, previewUrlMap);

    // 原本ASTのURLが保持されていることを確認。
    const originalImageNode = (
      parsed.ast.children[0] as { children: Array<{ url: string }> }
    ).children[0];
    expect(originalImageNode.url).toBe('images/sample.png?v=1');

    // クローンASTのURLが`blob URL` に置換されていることを確認。
    const clonedImageNode = (
      previewAst.children[0] as { children: Array<{ url: string }> }
    ).children[0];
    expect(clonedImageNode.url).toBe(
      'blob:http://localhost:3000/preview-uuid-1',
    );
  });
});

describe('replaceMarkdownImageUrls (Markdown生テキストURL置換)', () => {
  it('Markdown内の画像URLを正しくプレビューURLに置換できること', async () => {
    const md = 'はじめに ![アイコン](assets/icon.png?v=2) おわり';
    const parsed = await parseMarkdown(md);

    const urlMap = new Map<string, string>([
      ['assets/icon.png', 'blob:http://localhost/blob-id'],
    ]);

    const replaced = replaceMarkdownImageUrls(md, parsed.imageRefs, urlMap);

    expect(replaced).toBe(
      'はじめに ![アイコン](blob:http://localhost/blob-id?v=2) おわり',
    );
  });

  it('本文テキストやコードブロック内の同名文字列を誤置換しないこと', async () => {
    const md = `
ファイル名 icon.png の説明文。
\`\`\`bash
cp icon.png backup-icon.png
\`\`\`
実際の画像: ![アイコン](icon.png)
末尾テキスト。
`;
    const parsed = await parseMarkdown(md);

    const urlMap = new Map<string, string>([
      ['icon.png', 'blob:http://localhost/blob-icon'],
    ]);

    const replaced = replaceMarkdownImageUrls(md, parsed.imageRefs, urlMap);

    // 本文テキストの `"icon.png"` が誤置換されていないことを確認。
    expect(replaced).toContain('ファイル名 icon.png の説明文。');
    // コードブロック内の `"cp icon.png backup-icon.png"` が維持されていることを確認。
    expect(replaced).toContain('cp icon.png backup-icon.png');
    // 画像リンク構文のみ置換されていることを確認。
    expect(replaced).toContain(
      '実際の画像: ![アイコン](blob:http://localhost/blob-icon)',
    );
  });
});
