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

/** 要素の属性リストから既存の `className` 制限(タプル定義)を除去し、クラス名と行番号属性を許可する定義を返却する。 */
function allowClassAndLineAttributes(
  existing: Array<string | [string, ...unknown[]]> = [],
  additional: Array<string | [string, ...unknown[]]> = [],
): Array<string | [string, ...unknown[]]> {
  return updateAttributeDefinitions(existing, 'className', [
    'className',
    'class',
    ...lineAttributes,
    ...additional,
  ]);
}

/** 行番号リンクおよびディープリンク用の許可属性リスト。 */
const lineAttributes: string[] = [
  'id',
  'data-line',
  'data-line-start',
  'data-line-end',
  'dataLine',
  'dataLineStart',
  'dataLineEnd',
  'data-heading-id',
  'dataHeadingId',
  'line',
  'role',
  'tabIndex',
  'tabindex',
  'title',
  'ariaLabel',
  'aria-label',
  'ariaHidden',
  'aria-hidden',
];

/**
 * サニタイズ処理用のカスタムスキーマ。
 * シンタックスハイライト、見出しアンカー、GFMテーブル、行番号リンクの属性を保護する。
 */
export const sanitizeSchema = {
  ...defaultSchema,
  clobberPrefix: '',
  attributes: {
    ...defaultSchema.attributes,
    h1: allowClassAndLineAttributes(defaultSchema.attributes?.h1),
    h2: allowClassAndLineAttributes(defaultSchema.attributes?.h2),
    h3: allowClassAndLineAttributes(defaultSchema.attributes?.h3),
    h4: allowClassAndLineAttributes(defaultSchema.attributes?.h4),
    h5: allowClassAndLineAttributes(defaultSchema.attributes?.h5),
    h6: allowClassAndLineAttributes(defaultSchema.attributes?.h6),
    div: allowClassAndLineAttributes(defaultSchema.attributes?.div, [
      'style',
      'data-mermaid-code',
    ]),
    span: allowClassAndLineAttributes(defaultSchema.attributes?.span, [
      'style',
      'ariaHidden',
    ]),
    p: allowClassAndLineAttributes(defaultSchema.attributes?.p),
    blockquote: allowClassAndLineAttributes(
      defaultSchema.attributes?.blockquote,
    ),
    ul: allowClassAndLineAttributes(defaultSchema.attributes?.ul),
    ol: allowClassAndLineAttributes(defaultSchema.attributes?.ol),
    li: allowClassAndLineAttributes(defaultSchema.attributes?.li),
    code: allowClassAndLineAttributes(
      defaultSchema.attributes?.code as Array<string | [string, ...unknown[]]>,
      ['style'],
    ),
    pre: allowClassAndLineAttributes(defaultSchema.attributes?.pre, [
      'style',
      'data-mermaid-code',
    ]),
    a: updateAttributeDefinitions(
      defaultSchema.attributes?.a as Array<string | [string, ...unknown[]]>,
      'className',
      [
        'className',
        'class',
        'target',
        'rel',
        'title',
        'ariaHidden',
        'ariaLabel',
        ...lineAttributes,
      ],
    ),
    img: [
      ...(defaultSchema.attributes?.img || []),
      'loading',
      'decoding',
      'className',
      'class',
      ...lineAttributes,
    ],
    table: allowClassAndLineAttributes(defaultSchema.attributes?.table),
    thead: [...(defaultSchema.attributes?.thead || []), ...lineAttributes],
    tbody: [...(defaultSchema.attributes?.tbody || []), ...lineAttributes],
    tr: allowClassAndLineAttributes(defaultSchema.attributes?.tr),
    th: allowClassAndLineAttributes(defaultSchema.attributes?.th, ['align']),
    td: allowClassAndLineAttributes(defaultSchema.attributes?.td, ['align']),
    hr: [...(defaultSchema.attributes?.hr || []), ...lineAttributes],
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

/** 行番号属性(`data-line`)を付与する対象ブロック要素タグ一覧。 */
const BLOCK_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'ul',
  'ol',
  'li',
  'table',
  'tr',
  'pre',
  'hr',
]);

/** 左側にホバーアンカーアイコンを表示するブロックタグ一覧(見出しおよび本文)。 */
const ANCHOR_BLOCK_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'blockquote',
  'li',
]);

/**
 * Markdown原本の位置情報(`position`)に基づき、ブロック要素・テーブル・コード行へ行番号属性を付与し、
 * 左側アンカーボタンを注入するHAST走査プラグイン。
 */
function rehypeAddLineNumbers() {
  return (tree: HastRoot, file?: { value?: unknown }) => {
    /** 重複付与を防止するための採番済みIDセット。 */
    const usedIds = new Set<string>();
    /** 原本Markdown文字列を行ごとに分割した配列。 */
    const rawMarkdown = typeof file?.value === 'string' ? file.value : '';
    const rawLines = rawMarkdown ? rawMarkdown.split(/\r?\n/) : [];

    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName === 'pre') {
        const isMermaid =
          Array.isArray(node.properties?.className) &&
          node.properties.className.includes('mermaid');

        if (!isMermaid && Array.isArray(node.children)) {
          const codeEl = node.children.find(
            (c): c is Element => c.type === 'element' && c.tagName === 'code',
          );

          if (codeEl && Array.isArray(codeEl.children)) {
            const codeLines = codeEl.children.filter(
              (c): c is Element =>
                c.type === 'element' &&
                c.tagName === 'span' &&
                Array.isArray(c.properties?.className) &&
                c.properties.className.includes('code-line'),
            );

            if (codeLines.length > 0 && node.position?.start?.line) {
              const preStartLine = node.position.start.line;
              const preEndLine = node.position.end?.line ?? preStartLine;

              /**
               * 原本行テキストまたは位置情報の差分からフェンスコードブロック(` ``` ` または `~~~`)かを判定する。
               * 原本行が存在する場合は先頭のフェンス記号を直接検証し、インデントコードブロックや空行を含む例外ケースでも正確に採番する。
               */
              const startLineText =
                preStartLine >= 1 && preStartLine <= rawLines.length
                  ? rawLines[preStartLine - 1].trimStart()
                  : null;

              const isFenced =
                startLineText !== null
                  ? /^(`{3,}|~{3,})/.test(startLineText)
                  : preEndLine - preStartLine >= codeLines.length + 1;

              const firstLineNumber = isFenced
                ? preStartLine + 1
                : preStartLine;

              codeLines.forEach((lineNode, index) => {
                const lineNumber = firstLineNumber + index;
                lineNode.properties = lineNode.properties || {};
                lineNode.properties['data-line'] = String(lineNumber);
                const lineId = `L${lineNumber}`;
                if (!lineNode.properties.id && !usedIds.has(lineId)) {
                  lineNode.properties.id = lineId;
                  usedIds.add(lineId);
                }

                /** 行の左端にクリック可能な独立した行番号リンク要素。 */
                const lineNumberEl: Element = {
                  type: 'element',
                  tagName: 'span',
                  properties: {
                    role: 'button',
                    tabIndex: 0,
                    className: ['line-number'],
                    'data-line': String(lineNumber),
                    ariaLabel: `L${lineNumber}へのパーマリンク`,
                    title:
                      'クリックで行リンクをコピー (Shift+クリックで範囲選択)',
                  },
                  children: [{ type: 'text', value: String(index + 1) }],
                };
                lineNode.children = [lineNumberEl, ...lineNode.children];
              });
            }
          }
        }
      }

      if (
        node.tagName === 'table' &&
        parent &&
        typeof index === 'number' &&
        node.position?.start?.line
      ) {
        const startLine = node.position.start.line;
        const endLine = node.position.end?.line ?? startLine;

        const lineId = `L${startLine}`;
        if (!usedIds.has(lineId)) {
          usedIds.add(lineId);
        }

        /**
         * テーブル要素を包むラッパーコンテナ。
         *
         * WHATWG HTML仕様上、`<table>` 直下への `<span>` 挿入による構文崩れを防ぐため、
         * 外側ラッパーにアンカーボタンを配置し、内部をレスポンシブ横スクロールコンテナとする。
         * 内部の `table` への重複付与を防ぎ、外側ラッパーにのみ行属性とアンカーを持たせる。
         */
        const tableContainerEl: Element = {
          type: 'element',
          tagName: 'div',
          properties: {
            className: ['table-container', 'line-block'],
            'data-line-start': String(startLine),
            'data-line-end': String(endLine),
            'data-line': String(startLine),
            id: lineId,
          },
          children: [
            {
              type: 'element',
              tagName: 'span',
              properties: {
                role: 'button',
                tabIndex: 0,
                className: ['line-anchor'],
                'data-line': String(startLine),
                ariaLabel: `L${startLine}へのパーマリンク`,
                title: 'クリックで行リンクをコピー (Shift+クリックで範囲選択)',
              },
              children: [
                {
                  type: 'element',
                  tagName: 'span',
                  properties: {
                    className: ['line-anchor-icon'],
                    ariaHidden: 'true',
                  },
                  children: [{ type: 'text', value: '#' }],
                },
              ],
            },
            {
              type: 'element',
              tagName: 'div',
              properties: {
                className: ['table-scroll'],
              },
              children: [node],
            },
          ],
        };

        (parent.children as unknown[])[index] = tableContainerEl;
        return;
      }

      if (BLOCK_TAGS.has(node.tagName) && node.position?.start?.line) {
        const startLine = node.position.start.line;
        const endLine = node.position.end?.line ?? startLine;

        /** リスト項目(`li`)または引用(`blockquote`)の内側にネストされた段落かどうかの判定フラグ。親要素がアンカーを担うため二重付与を防ぐ。 */
        const isNestedParagraph =
          node.tagName === 'p' &&
          parent &&
          typeof parent === 'object' &&
          'tagName' in parent &&
          ((parent as Element).tagName === 'li' ||
            (parent as Element).tagName === 'blockquote');

        node.properties = node.properties || {};
        node.properties['data-line-start'] = String(startLine);
        node.properties['data-line-end'] = String(endLine);
        node.properties['data-line'] = String(startLine);

        if (!isNestedParagraph) {
          const existingClass = node.properties.className;
          const classList: string[] = Array.isArray(existingClass)
            ? existingClass.map(String)
            : [];
          if (!classList.includes('line-block')) {
            node.properties.className = [...classList, 'line-block'];
          }

          if (!node.properties.id && !node.tagName.startsWith('h')) {
            const lineId = `L${startLine}`;
            if (!usedIds.has(lineId)) {
              node.properties.id = lineId;
              usedIds.add(lineId);
            }
          }
        }

        if (
          !isNestedParagraph &&
          ANCHOR_BLOCK_TAGS.has(node.tagName) &&
          Array.isArray(node.children)
        ) {
          const isHeading = node.tagName.startsWith('h');
          const headingId = isHeading
            ? String(node.properties.id || '')
            : undefined;

          const lineAnchorEl: Element = {
            type: 'element',
            tagName: 'span',
            properties: {
              role: 'button',
              tabIndex: 0,
              className: isHeading
                ? ['line-anchor', 'heading-anchor']
                : ['line-anchor'],
              'data-line': String(startLine),
              ...(headingId ? { 'data-heading-id': headingId } : {}),
              ariaLabel: isHeading
                ? `${headingId || `L${startLine}`} へのパーマリンク`
                : `L${startLine}へのパーマリンク`,
              title: 'クリックでリンクをコピー (Shift+クリックで範囲選択)',
            },
            children: [
              {
                type: 'element',
                tagName: 'span',
                properties: {
                  className: ['line-anchor-icon'],
                  ariaHidden: 'true',
                },
                children: [{ type: 'text', value: '#' }],
              },
            ],
          };
          node.children = [lineAnchorEl, ...node.children];
        }
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
  .use(rehypeProtectMermaid)
  .use(rehypePrism, { ignoreMissing: true })
  .use(rehypeRestoreMermaid)
  .use(rehypeAddLineNumbers)
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
