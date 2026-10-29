import type {
  Root,
  Image,
  ImageReference,
  Definition,
  Heading,
  Text,
  InlineCode,
} from 'mdast';
import { visit, EXIT } from 'unist-util-visit';
import { isExternalUrl, normalizeRelativePath } from './path';
import type { ExtractedImageRef } from './types';

/**
 * MDASTから画像参照ノードを走査・抽出し、正規化された参照情報一覧を生成する。
 *
 * @param ast - MDAST構文木のルートノード。
 * @param baseFilePath - Markdownファイル自体の相対パス(基準ディレクトリ解決用)。
 * @returns 抽出された画像参照リストおよび外部URL参照の件数。
 */
export function extractImageReferences(
  ast: Root,
  baseFilePath = '',
): { imageRefs: ExtractedImageRef[]; externalImageCount: number } {
  const imageRefs: ExtractedImageRef[] = [];
  let externalImageCount = 0;

  // 参照形式リンク([ref]: url)の定義ノードを収集する。
  const definitionMap = new Map<string, Definition>();
  visit(ast, 'definition', (node: Definition) => {
    if (node.identifier) {
      definitionMap.set(node.identifier.toLowerCase(), node);
    }
  });

  // 標準画像ノード(![alt](url))の走査。
  visit(ast, 'image', (node: Image) => {
    if (!node.url) {
      return;
    }

    if (isExternalUrl(node.url)) {
      externalImageCount += 1;
      return;
    }

    const { cleanPath, queryParams } = normalizeRelativePath(
      node.url,
      baseFilePath,
    );

    // 有効な相対パスが存在する場合のみ登録する。
    if (cleanPath) {
      imageRefs.push({
        rawUrl: node.url,
        cleanPath,
        queryParams,
        alt: node.alt || null,
        title: node.title || null,
        node,
        position: node.position,
      });
    }
  });

  // 参照形式画像ノード(![alt][ref])の走査。
  // 同一の定義リンクが複数箇所で使用されている場合でも、登場箇所(position/alt)ごとに抽出情報を記録する。
  // 各参照情報のnodeプロパティは共通のdefNodeを参照するため、Step 1.10でのURL置換時は重複を排除して一括置換可能。
  visit(ast, 'imageReference', (node: ImageReference) => {
    const identifier = node.identifier?.toLowerCase();
    if (!identifier) {
      return;
    }

    const defNode = definitionMap.get(identifier);
    if (!defNode || !defNode.url) {
      return;
    }

    if (isExternalUrl(defNode.url)) {
      externalImageCount += 1;
      return;
    }

    const { cleanPath, queryParams } = normalizeRelativePath(
      defNode.url,
      baseFilePath,
    );

    if (cleanPath) {
      imageRefs.push({
        rawUrl: defNode.url,
        cleanPath,
        queryParams,
        alt: node.alt || null,
        title: defNode.title || null,
        node: defNode,
        position: node.position,
      });
    }
  });

  return {
    imageRefs,
    externalImageCount,
  };
}

/**
 * MDASTから最初のH1見出し(heading depth: 1)のテキストを抽出し、ドキュメントタイトル候補を返す。
 *
 * @param ast - MDAST構文木のルートノード。
 * @returns 抽出されたタイトル文字列。見出しが存在しない場合はnull。
 */
export function extractDocumentTitle(ast: Root): string | null {
  let title: string | null = null;

  visit(ast, 'heading', (node: Heading) => {
    if (node.depth === 1) {
      const textParts: string[] = [];

      visit(node, (child) => {
        if (child.type === 'text') {
          textParts.push((child as Text).value);
        } else if (child.type === 'inlineCode') {
          textParts.push((child as InlineCode).value);
        }
      });

      const extracted = textParts.join('').trim();
      if (extracted.length > 0) {
        title = extracted;
        return EXIT;
      }
    }
  });

  return title;
}
