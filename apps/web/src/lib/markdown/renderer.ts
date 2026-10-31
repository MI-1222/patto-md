import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypePrism from 'rehype-prism-plus/common';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';
import type { Root as HastRoot, Element } from 'hast';

/** Markdownレンダリングのオプション定義。 */
export interface RenderMarkdownOptions {
  /**
   * `/api/assets/` で始まる画像パスに前置するAPIベースURL。
   * 指定時は絶対URLへ置換され、未指定時は相対パスを維持する。
   */
  assetBaseUrl?: string;
}

/** Markdownレンダリング結果オブジェクト。 */
export interface RenderMarkdownResult {
  /** 完全サニタイズ済みのHTML文字列。 */
  html: string;
}

/**
 * 既存の属性配列から指定プロパティ定義を除外し、新しい定義を追加するヘルパー。
 */
function updateAttributeDefinitions(
  existing: Array<string | [string, ...unknown[]]> = [],
  removeName: string,
  additions: Array<string | [string, ...unknown[]]>,
): Array<string | [string, ...unknown[]]> {
  const filtered = existing.filter((item) => {
    const name = typeof item === 'string' ? item : item[0];
    return name !== removeName;
  });
  return [...filtered, ...additions];
}

/**
 * サニタイズ処理用のカスタムスキーマ。
 * シンタックスハイライト、見出しアンカー、GFMテーブルの属性を保護する。
 */
export const sanitizeSchema = {
  ...defaultSchema,
  clobberPrefix: '',
  attributes: {
    ...defaultSchema.attributes,
    h1: [...(defaultSchema.attributes?.h1 || []), 'id'],
    h2: [...(defaultSchema.attributes?.h2 || []), 'id'],
    h3: [...(defaultSchema.attributes?.h3 || []), 'id'],
    h4: [...(defaultSchema.attributes?.h4 || []), 'id'],
    h5: [...(defaultSchema.attributes?.h5 || []), 'id'],
    h6: [...(defaultSchema.attributes?.h6 || []), 'id'],
    div: [
      ...(defaultSchema.attributes?.div || []),
      'className',
      'class',
      'style',
      'data-mermaid-code',
    ],
    span: [
      ...(defaultSchema.attributes?.span || []),
      'className',
      'class',
      'style',
      'ariaHidden',
    ],
    code: updateAttributeDefinitions(
      defaultSchema.attributes?.code as Array<string | [string, ...unknown[]]>,
      'className',
      ['className', 'class', 'style'],
    ),
    pre: [
      ...(defaultSchema.attributes?.pre || []),
      'className',
      'class',
      'style',
      'data-mermaid-code',
    ],
    a: updateAttributeDefinitions(
      defaultSchema.attributes?.a as Array<string | [string, ...unknown[]]>,
      'className',
      ['className', 'class', 'target', 'rel', 'ariaHidden', 'ariaLabel'],
    ),
    img: [
      ...(defaultSchema.attributes?.img || []),
      'loading',
      'decoding',
      'className',
      'class',
    ],
    table: [...(defaultSchema.attributes?.table || []), 'className', 'class'],
    th: [
      ...(defaultSchema.attributes?.th || []),
      'align',
      'className',
      'class',
    ],
    td: [
      ...(defaultSchema.attributes?.td || []),
      'align',
      'className',
      'class',
    ],
  },
};

/** HAST内のMermaidコードブロックを一時的に退避し、`rehypePrism` による構文分解を防ぐ `rehype` プラグイン。 */
function rehypeProtectMermaid() {
  return (tree: HastRoot) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (
        node.tagName === 'pre' &&
        Array.isArray(node.children) &&
        node.children.length > 0
      ) {
        const firstChild = node.children[0];
        if (
          firstChild &&
          firstChild.type === 'element' &&
          firstChild.tagName === 'code'
        ) {
          const rawClassName = firstChild.properties?.className as unknown;
          const classList: string[] = Array.isArray(rawClassName)
            ? rawClassName.map((c) => String(c))
            : typeof rawClassName === 'string'
              ? rawClassName.split(' ')
              : [];

          const isMermaid = classList.some(
            (c: string) => c === 'language-mermaid' || c === 'mermaid',
          );

          if (isMermaid) {
            /** コードブロック内の生テキスト。 */
            const codeText = firstChild.children
              .filter((c) => c.type === 'text')
              .map((c) => (c as { value: string }).value)
              .join('');

            /** 一時的なMermaid退避用要素。 */
            const placeholderNode: Element = {
              type: 'element',
              tagName: 'div',
              properties: {
                className: ['mermaid-block'],
                'data-mermaid-code': codeText,
              },
              children: [{ type: 'text', value: codeText }],
            };

            if (parent && typeof index === 'number') {
              (parent.children as unknown[])[index] = placeholderNode;
            }
          }
        }
      }
    });
  };
}

/** 一時退避されたMermaid要素を、安全な `<pre class="mermaid"><code>` 構造へ復元する `rehype` プラグイン。 */
function rehypeRestoreMermaid() {
  return (tree: HastRoot) => {
    visit(tree, 'element', (node: Element) => {
      if (
        node.tagName === 'div' &&
        Array.isArray(node.properties?.className) &&
        node.properties.className.includes('mermaid-block')
      ) {
        /** 退避されていたMermaid生コード文字列。 */
        const codeText = String(node.properties['data-mermaid-code'] ?? '');
        node.children = [
          {
            type: 'element',
            tagName: 'pre',
            properties: {
              className: ['mermaid'],
              'data-mermaid-code': codeText,
            },
            children: [
              {
                type: 'element',
                tagName: 'code',
                properties: {},
                children: [{ type: 'text', value: codeText }],
              },
            ],
          },
        ];
      }
    });
  };
}

/**
 * HAST内の画像ノードを走査し、アセットURLを正規化する `rehype` プラグイン。
 * `file.data.assetBaseUrl` からベースURLを取得し、`/api/assets/` で始まる画像パスを絶対URLへ変換する。
 */
function rehypeResolveAssetUrls() {
  return (tree: HastRoot, file: { data?: Record<string, unknown> }) => {
    const baseUrl = file.data?.assetBaseUrl;
    if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
      return;
    }
    /** 末尾のスラッシュを除去して正規化したAPIベースURL。 */
    const normalizedBase = baseUrl.replace(/\/+$/, '');

    visit(tree, 'element', (node: Element) => {
      if (node.tagName === 'img' && node.properties?.src) {
        const src = String(node.properties.src);
        if (src.startsWith('/api/assets/')) {
          node.properties.src = `${normalizedBase}${src}`;
        }
      }
    });
  };
}

/**
 * モジュールスコープで初期化し、イミュータブルに凍結した `unified` プロセッサ。
 * リクエストごとのプラグイン再登録処理を省き、Cloudflare Workers や Cloudflare Pages での実行負荷を抑える。
 */
const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: false })
  .use(rehypeSlug)
  .use(rehypeAutolinkHeadings, {
    behavior: 'append',
    properties: {
      className: ['heading-anchor'],
      ariaLabel: '見出しへのパーマリンク',
    },
    content: {
      type: 'element',
      tagName: 'span',
      properties: { className: ['heading-anchor-icon'], ariaHidden: 'true' },
      children: [{ type: 'text', value: '#' }],
    },
  })
  .use(rehypeProtectMermaid)
  .use(rehypePrism, { ignoreMissing: true })
  .use(rehypeRestoreMermaid)
  .use(rehypeResolveAssetUrls)
  .use(
    rehypeSanitize,
    sanitizeSchema as unknown as Parameters<typeof rehypeSanitize>[0],
  )
  .use(rehypeStringify)
  .freeze();

/**
 * Markdown文字列をHTMLへ変換する。
 * GFM拡張構文、見出しアンカー、コードハイライト、サニタイズ処理を適用する。
 *
 * @param markdown - レンダリング対象のMarkdown文字列。
 * @param options - アセットURL解決オプション。
 * @returns サニタイズ済みHTMLを含む変換結果。
 */
export async function renderMarkdown(
  markdown: string,
  options: RenderMarkdownOptions = {},
): Promise<RenderMarkdownResult> {
  const file = await markdownProcessor.process({
    value: markdown,
    data: {
      assetBaseUrl: options.assetBaseUrl,
    },
  });

  return {
    html: String(file),
  };
}

/**
 * Markdown本文から装飾記号を除去し、OGP用の要約テキストを抽出する。
 *
 * @param markdown - 抽出元のMarkdown文字列。
 * @param maxLength - 抽出する最大文字数。デフォルトは 140 文字。
 * @returns 抽出したプレーンテキスト。
 */
export function extractDescription(
  markdown: string,
  maxLength: number = 140,
): string {
  if (!markdown || typeof markdown !== 'string') {
    return '';
  }

  /** 各種Markdown装飾記号を除去したプレーンテキスト。 */
  const plainText = markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (plainText.length <= maxLength) {
    return plainText;
  }

  return `${plainText.slice(0, maxLength)}...`;
}
