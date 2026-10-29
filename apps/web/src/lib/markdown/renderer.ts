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

/**
 * HAST構文木内の画像ノードを走査し、アセットURLを正規化するプラグイン。
 *
 * @param baseUrl - 前置するAPIベースURL文字列。
 */
function rehypeResolveAssetUrls(baseUrl?: string) {
  return (tree: HastRoot) => {
    if (!baseUrl) {
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
 * サーバーサイドでMarkdown文字列を安全なHTML文字列へレンダリングする。
 * GFM拡張構文、見出しアンカー、コードハイライト、XSSサニタイズを適用する。
 *
 * @param markdown - レンダリング対象のMarkdown生テキスト。
 * @param options - アセットURL解決オプション。
 * @returns サニタイズ済みHTMLを含むレンダリング結果。
 */
export async function renderMarkdown(
  markdown: string,
  options: RenderMarkdownOptions = {},
): Promise<RenderMarkdownResult> {
  const processor = unified()
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
    .use(rehypePrism, { ignoreMissing: true })
    .use(rehypeResolveAssetUrls, options.assetBaseUrl)
    .use(
      rehypeSanitize,
      sanitizeSchema as unknown as Parameters<typeof rehypeSanitize>[0],
    )
    .use(rehypeStringify);

  const file = await processor.process(markdown);
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
