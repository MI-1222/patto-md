import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../../../lib/markdown/parser';
import { reconcileAssets } from '../../../lib/markdown/reconcile';
import type { VirtualFile } from '../types';

function createVirtualFile(
  relativePath: string,
  content = 'image',
): VirtualFile {
  const fileName = relativePath.split('/').pop() || 'test.png';
  return {
    file: new File([content], fileName, { type: 'image/png' }),
    relativePath,
    isSizeExceeded: false,
    isTypeUnsupported: false,
  };
}

describe('ファイルドロップと仮想ファイル突合の一連フロー検証', () => {
  it('不足画像が存在する状態から追加入力によって過不足なく完全解決へ遷移すること', async () => {
    // 1. 2枚の画像を要求するMarkdownを投入。
    const md = `
# 開発ガイド
![設計図](docs/arch.png)
説明文。
![フロー](docs/flow.png)
`;
    const parsed = await parseMarkdown(md, { basePath: 'README.md' });
    expect(parsed.imageRefs.length).toBe(2);

    // 2. 最初は `arch.png` のみ投入(`flow.png` が未解決)。
    const initialAssets = new Map<string, VirtualFile>([
      ['docs/arch.png', createVirtualFile('docs/arch.png')],
    ]);

    const firstResult = reconcileAssets(parsed.imageRefs, initialAssets);
    expect(firstResult.isComplete).toBe(false);
    expect(firstResult.resolved.size).toBe(1);
    expect(firstResult.missing.length).toBe(1);
    expect(firstResult.missing[0].cleanPath).toBe('docs/flow.png');

    // 3. 追加入力で `flow.png` を投入(マージ)。
    const mergedAssets = new Map(initialAssets);
    mergedAssets.set('docs/flow.png', createVirtualFile('docs/flow.png'));

    const secondResult = reconcileAssets(parsed.imageRefs, mergedAssets);
    expect(secondResult.isComplete).toBe(true);
    expect(secondResult.resolved.size).toBe(2);
    expect(secondResult.missing.length).toBe(0);
    expect(secondResult.unused.length).toBe(0);
  });

  it('不要な余剰画像が除外され、要求された画像のみが解決されること', async () => {
    const md = '![ロゴ](logo.png)';
    const parsed = await parseMarkdown(md);

    const assets = new Map<string, VirtualFile>([
      ['logo.png', createVirtualFile('logo.png')],
      ['extra1.png', createVirtualFile('extra1.png')],
      ['extra2.jpg', createVirtualFile('extra2.jpg')],
    ]);

    const result = reconcileAssets(parsed.imageRefs, assets);
    expect(result.isComplete).toBe(true);
    expect(result.resolved.size).toBe(1);
    expect(result.unused.length).toBe(2);
    expect(result.unused.map((u) => u.relativePath)).toContain('extra1.png');
    expect(result.unused.map((u) => u.relativePath)).toContain('extra2.jpg');
  });
});
