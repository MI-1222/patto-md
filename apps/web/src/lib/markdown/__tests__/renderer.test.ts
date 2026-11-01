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

    expect(html).toContain('<table');
    expect(html).toContain('項目</th>');
    expect(html).toContain('TypeScript</td>');
    expect(html).toContain('<del>取り消し線</del>');
    expect(html).toContain('type="checkbox"');
  });

  it('テーブル要素にtable-containerラッパーと左側アンカーリンクを付与する。', async () => {
    const markdown = `
| 列1 | 列2 |
|---|---|
| A | B |
`;

    const { html } = await renderMarkdown(markdown);

    expect(html).toContain('class="table-container line-block"');
    expect(html).toContain('class="table-scroll"');
    expect(html).toContain('class="line-anchor"');
    expect(html).toContain('data-line="2"');
    expect(html).toContain('id="L2"');
    expect(html).toContain('<table');
    // 内部の `table` 要素には重複して `data-line` が付与されていないこと。
    expect(html).not.toMatch(/<table[^>]*data-line=/);
  });

  it('箇条書き項目(li)にアンカーを付与し、内部段落(p)との二重化を防止する。', async () => {
    const markdown = `
- 箇条書き1

- 箇条書き2
`;

    const { html } = await renderMarkdown(markdown);
    // `line-anchor` ボタンの出現回数が箇条書き項目数(2個)と一致すること(p要素への二重付与防止)。
    const anchorMatches =
      html.match(/role="button"[^>]*class="[^"]*line-anchor[^"]*"/g) || [];
    expect(anchorMatches).toHaveLength(2);

    // p要素には `line-block` が付与されていないこと。
    expect(html).not.toMatch(/<p[^>]*class="[^"]*line-block/);
  });

  it('見出し要素に推測可能なidおよびアンカーリンクを自動付与する。', async () => {
    const markdown = `
# システム概要
## アーキテクチャ設計
`;

    const { html } = await renderMarkdown(markdown);

    expect(html).toContain('<h1 id="システム概要"');
    expect(html).toContain('data-heading-id="システム概要"');
    expect(html).toContain('class="line-block"');
    expect(html).toContain('<h2 id="アーキテクチャ設計"');
    expect(html).toContain('data-heading-id="アーキテクチャ設計"');
    expect(html).toContain('heading-anchor');
    expect(html).toContain('role="button"');
  });

  it('コードブロックのシンタックスハイライトクラスを付与する。', async () => {
    const markdown = `
\`\`\`typescript
const greeting: string = "hello";
\`\`\`
`;

    const { html } = await renderMarkdown(markdown);

    expect(html).toContain('class="language-typescript line-block"');
    expect(html).toContain('class="language-typescript code-highlight"');
    expect(html).toContain('token keyword');
    expect(html).toContain('token string');
  });

  it('ブロック要素およびコード行に原本行番号属性(data-line)を付与する。', async () => {
    const markdown = `
# タイトル

段落テキストです。

\`\`\`typescript
const a = 1;
const b = 2;
\`\`\`
`;

    const { html } = await renderMarkdown(markdown);

    // 見出しの行番号と左側アンカー。
    expect(html).toContain('id="タイトル"');
    expect(html).toContain('data-line-start="2"');
    expect(html).toContain('data-line="2"');
    expect(html).toContain('heading-anchor');
    expect(html).toContain('data-heading-id="タイトル"');

    // 段落の行番号と左側アンカー。
    expect(html).toContain('data-line-start="4"');
    expect(html).toContain('id="L4"');
    expect(html).toContain('line-anchor');
    expect(html).toContain('data-line="4"');
    expect(html).toContain('段落テキストです。');
    // コードブロック親要素の行番号。
    expect(html).toContain('data-line-start="6"');
    expect(html).toContain('data-line-end="9"');
    expect(html).toContain('data-line="6"');
    expect(html).toContain('id="L6"');
    // コードブロック各行の原本行番号(フェンスの次行である7, 8)。
    expect(html).toContain('data-line="7"');
    expect(html).toContain('id="L7"');
    expect(html).toContain('data-line="8"');
    expect(html).toContain('id="L8"');
    expect(html).toContain('class="code-line"');
    expect(html).toContain('class="line-number"');
    expect(html).toContain('data-line="7"');
    expect(html).toContain('data-line="8"');
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
    expect(html).toContain('<h1 id="タイトル"');
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

  it('Mermaidコードブロックをシンタックスハイライトから除外し、プレースホルダーとして出力する。', async () => {
    const markdown = `
\`\`\`mermaid
flowchart TD
    A[開始] --> B{判定}
    B -->|Yes| C[完了]
    B -->|No| D[終了]
\`\`\`
`;

    const { html } = await renderMarkdown(markdown);

    expect(html).toContain('class="mermaid-block"');
    expect(html).toContain('data-mermaid-code="flowchart TD');
    expect(html).toContain('<pre class="mermaid"');
    expect(html).not.toContain('class="language-mermaid');
    expect(html).not.toContain('token keyword');
    expect(html).toContain('A[開始] --> B{判定}');
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
