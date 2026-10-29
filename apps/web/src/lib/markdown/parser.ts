import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root } from 'mdast';
import { extractImageReferences, extractDocumentTitle } from './traverse';
import type { MarkdownParseResult, ParseMarkdownOptions } from './types';

/**
 * ドロップされたMarkdown文字列をMDASTへパースし、ローカル画像参照とタイトルを抽出する。
 * ブラウザのメインスレッドをブロックしないよう非同期関数として提供される。
 *
 * @param content - Markdown生テキスト文字列。
 * @param options - パス解決およびタイトルフォールバック設定。
 * @returns 解析結果オブジェクト(AST、画像参照一覧、ユニークパス一覧、タイトル等)。
 */
export async function parseMarkdown(
  content: string,
  options: ParseMarkdownOptions = {},
): Promise<MarkdownParseResult> {
  try {
    // remark-parse および remark-gfm プラグインを適用したプロセッサを構築する。
    const processor = unified().use(remarkParse).use(remarkGfm);
    const ast = processor.parse(content) as Root;

    // ASTノードを走査し、画像参照およびタイトルを抽出する。
    const { imageRefs, externalImageCount } = extractImageReferences(
      ast,
      options.basePath,
    );

    const extractedH1 = extractDocumentTitle(ast);
    const finalTitle = extractedH1 || options.fallbackTitle || null;

    // 解決対象の相対パスを重複排除してリスト化する。
    const uniqueAssetPaths = Array.from(
      new Set(imageRefs.map((ref) => ref.cleanPath)),
    );

    return {
      ast,
      imageRefs,
      uniqueAssetPaths,
      title: finalTitle,
      externalImageCount,
    };
  } catch (_error) {
    // 構文解析エラー時のフォールバック処理。
    const fallbackAst: Root = {
      type: 'root',
      children: [],
    };

    return {
      ast: fallbackAst,
      imageRefs: [],
      uniqueAssetPaths: [],
      title: options.fallbackTitle || null,
      externalImageCount: 0,
    };
  }
}
