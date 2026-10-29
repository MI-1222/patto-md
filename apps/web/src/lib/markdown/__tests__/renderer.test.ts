import { describe, expect, it } from 'vitest';
import { extractDescription, renderMarkdown } from '../renderer';

describe('Markdownレンダリングパイプライン(renderMarkdown)', () => {
  it('GFM拡張構文(テーブル、打ち消し線、タスクリスト)を正常にHTML変換する。', async () => {
    const markdown = `
| 項目 | 値 |
| :--- | :--- |
| 言語 | TypeScript |

これは ~~取り消し線~~ です。

- [x] 完了タスク
- [ ] 未完了タスク
`;

    const { html } = await renderMarkdown(markdown);

    expect(html).toContain('<table>');
    expect(html).toContain('項目</th>');
    expect(html).toContain('TypeScript</td>');
    expect(html).toContain('<del>取り消し線</del>');
    expect(html).toContain('type="checkbox"');
  });

  it('見出し要素に推測可能なidおよびアンカーリンクを自動付与する。', async () => {
    const markdown = `
# システム概要
## アーキテクチャ設計
`;

    const { html } = await renderMarkdown(markdown);

    expect(html).toContain('<h1 id="システム概要">');
    expect(html).toContain('href="#システム概要"');
    expect(html).toContain('<h2 id="アーキテクチャ設計">');
    expect(html).toContain('href="#アーキテクチャ設計"');
    expect(html).toContain('class="heading-anchor"');
  });

  it('コードブロックのシンタックスハイライトクラスを付与する。', async () => {
    const markdown = `
\`\`\`typescript
const greeting: string = "hello";
\`\`\`
`;

    const { html } = await renderMarkdown(markdown);

    expect(html).toContain('<pre class="language-typescript">');
    expect(html).toContain('class="language-typescript code-highlight"');
    expect(html).toContain('token keyword');
    expect(html).toContain('token string');
  });

  it('悪意あるスクリプトや不正属性をサニタイズして除去する。', async () => {
    const maliciousMarkdown = `
# タイトル
<script>alert("XSS")</script>
<img src="x" onerror="alert(1)" />
<a href="javascript:alert(1)">危険なリンク</a>
`;

    const { html } = await renderMarkdown(maliciousMarkdown);

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert("XSS")');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:alert(1)');
    expect(html).toContain('<h1 id="タイトル">');
  });

  it('assetBaseUrlが指定された場合、/api/assets/の画像パスを絶対URLへ解決する。', async () => {
    const markdown = `
![サンプル画像](/api/assets/temp/uploads/123/image.png)
![外部画像](https://example.com/external.png)
`;

    const { html } = await renderMarkdown(markdown, {
      assetBaseUrl: 'https://api.patto-md.local',
    });

    expect(html).toContain(
      'src="https://api.patto-md.local/api/assets/temp/uploads/123/image.png"',
    );
    expect(html).toContain('src="https://example.com/external.png"');
  });

  it('assetBaseUrlが未指定の場合、元の相対パスを維持する。', async () => {
    const markdown = `
![サンプル画像](/api/assets/temp/uploads/123/image.png)
`;

    const { html } = await renderMarkdown(markdown);

    expect(html).toContain('src="/api/assets/temp/uploads/123/image.png"');
  });
});

describe('プレーンテキスト抽出(extractDescription)', () => {
  it('各種Markdown記号を除去してプレーンテキストを抽出する。', () => {
    const markdown = `
# 見出し1
## 見出し2

これは **太字** と *斜体* と ~~取り消し~~ のテストです。

> これは引用文です。

- リスト1
- [リンクテキスト](https://example.com)
- ![画像代替テキスト](/path/to/img.png)

\`\`\`typescript
const code = 123;
\`\`\`

インラインの \`code\` も含まれます。
`;

    const description = extractDescription(markdown, 100);

    expect(description).not.toContain('#');
    expect(description).not.toContain('**');
    expect(description).not.toContain('const code = 123');
    expect(description).toContain('太字 と 斜体 と 取り消し のテストです');
    expect(description).toContain('リンクテキスト');
    expect(description).not.toContain('https://example.com');
    expect(description).toContain('インラインの code も含まれます');
  });

  it('maxLengthを超える場合は省略記号(...)を付加する。', () => {
    const markdown = 'あ'.repeat(150);
    const result = extractDescription(markdown, 100);

    expect(result.length).toBe(103);
    expect(result.endsWith('...')).toBe(true);
  });

  it('空文字や無効な入力に対して空文字を返却する。', () => {
    expect(extractDescription('')).toBe('');
    expect(extractDescription(null as unknown as string)).toBe('');
  });
});
