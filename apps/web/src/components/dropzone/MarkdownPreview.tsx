import React from 'react';
import type { Root, RootContent } from 'mdast';
import { WarningSvg } from '../svg/FileIcons';

/** ローカルプレビューコンポーネントのプロパティ定義。 */
interface MarkdownPreviewProps {
  /** ドキュメントのタイトル。 */
  title: string | null;
  /** 原本またはプレビュー用AST。 */
  ast: Root | null;
  /** 解決済みプレビューURLマップ(キー: `cleanPath`)。 */
  previewUrlMap: Map<string, string>;
  /** 未解決アセットパスのセット。 */
  missingPaths?: Set<string>;
}

/**
 * `MDAST` ノードをReact要素へ安全に変換・描画する再帰ヘルパー。
 *
 * @param node - 対象ノード。
 * @param index - リスト内インデックス。
 * @param previewUrlMap - 解決済みBlob URLマップ。
 * @param missingPaths - 未解決パス一覧。
 * @returns React要素。
 */
function renderAstNode(
  node: RootContent | Root,
  index: number,
  previewUrlMap: Map<string, string>,
  missingPaths: Set<string>,
): React.ReactNode {
  if (!node) {
    return null;
  }

  const key = `${node.type}-${index}`;

  switch (node.type) {
    case 'root':
      return (
        <div key={key} className="space-y-4">
          {node.children.map((child, i) =>
            renderAstNode(child, i, previewUrlMap, missingPaths),
          )}
        </div>
      );

    case 'heading': {
      const depth = node.depth;
      const content = node.children.map((c, i) =>
        renderAstNode(c, i, previewUrlMap, missingPaths),
      );
      if (depth === 1) {
        return (
          <h1
            key={key}
            className="border-b border-neutral-800 pb-2 text-2xl font-bold tracking-tight text-neutral-100"
          >
            {content}
          </h1>
        );
      }
      if (depth === 2) {
        return (
          <h2
            key={key}
            className="border-b border-neutral-800/60 pb-1.5 text-xl font-semibold text-neutral-100"
          >
            {content}
          </h2>
        );
      }
      if (depth === 3) {
        return (
          <h3 key={key} className="text-lg font-medium text-neutral-200">
            {content}
          </h3>
        );
      }
      return (
        <h4 key={key} className="text-base font-medium text-neutral-300">
          {content}
        </h4>
      );
    }

    case 'paragraph':
      return (
        <p key={key} className="leading-relaxed text-neutral-300">
          {node.children.map((c, i) =>
            renderAstNode(c, i, previewUrlMap, missingPaths),
          )}
        </p>
      );

    case 'text':
      return <span key={key}>{node.value}</span>;

    case 'strong':
      return (
        <strong key={key} className="font-semibold text-neutral-100">
          {node.children.map((c, i) =>
            renderAstNode(c, i, previewUrlMap, missingPaths),
          )}
        </strong>
      );

    case 'emphasis':
      return (
        <em key={key} className="text-neutral-200 italic">
          {node.children.map((c, i) =>
            renderAstNode(c, i, previewUrlMap, missingPaths),
          )}
        </em>
      );

    case 'delete':
      return (
        <del key={key} className="text-neutral-500 line-through">
          {node.children.map((c, i) =>
            renderAstNode(c, i, previewUrlMap, missingPaths),
          )}
        </del>
      );

    case 'inlineCode':
      return (
        <code
          key={key}
          className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-xs text-blue-300"
        >
          {node.value}
        </code>
      );

    case 'code':
      return (
        <div key={key} className="overflow-hidden rounded-xl bg-neutral-950">
          {node.lang && (
            <div className="border-b border-neutral-800 px-4 py-1 font-mono text-[11px] text-neutral-400">
              {node.lang}
            </div>
          )}
          <pre className="overflow-x-auto p-4 font-mono text-xs text-neutral-200">
            <code>{node.value}</code>
          </pre>
        </div>
      );

    case 'image': {
      const rawUrl = node.url || '';
      const cleanKey = rawUrl.split(/[?#]/)[0].replace(/^(\.\/|\/)+/, '');
      const blobUrl = previewUrlMap.get(cleanKey) || previewUrlMap.get(rawUrl);
      const isMissing = missingPaths.has(cleanKey) || !blobUrl;

      if (
        isMissing &&
        !rawUrl.startsWith('http://') &&
        !rawUrl.startsWith('https://')
      ) {
        return (
          <span
            key={key}
            className="my-3 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-950/20 p-3 text-xs text-amber-300"
          >
            <WarningSvg className="size-4 shrink-0 text-amber-400" />
            <span>
              未解決画像: <code className="font-mono">{cleanKey}</code>
              {node.alt ? ` (alt: "${node.alt}")` : ''}
            </span>
          </span>
        );
      }

      return (
        <figure key={key} className="my-4">
          <img
            src={blobUrl || rawUrl}
            alt={node.alt || ''}
            title={node.title || undefined}
            className="max-h-96 w-auto max-w-full rounded-lg border border-neutral-800 object-contain shadow-md"
            loading="lazy"
          />
          {node.alt && (
            <figcaption className="mt-1.5 text-center text-xs text-neutral-400">
              {node.alt}
            </figcaption>
          )}
        </figure>
      );
    }

    case 'list': {
      const Tag = node.ordered ? 'ol' : 'ul';
      const listStyle = node.ordered ? 'list-decimal' : 'list-disc';
      return (
        <Tag
          key={key}
          className={`space-y-1 pl-6 ${listStyle} text-neutral-300`}
        >
          {node.children.map((c, i) =>
            renderAstNode(c, i, previewUrlMap, missingPaths),
          )}
        </Tag>
      );
    }

    case 'listItem':
      return (
        <li key={key} className="leading-relaxed">
          {node.children.map((c, i) =>
            renderAstNode(c, i, previewUrlMap, missingPaths),
          )}
        </li>
      );

    case 'blockquote':
      return (
        <blockquote
          key={key}
          className="border-l-4 border-neutral-700 pl-4 text-neutral-400 italic"
        >
          {node.children.map((c, i) =>
            renderAstNode(c, i, previewUrlMap, missingPaths),
          )}
        </blockquote>
      );

    case 'link':
      return (
        <a
          key={key}
          href={node.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 underline underline-offset-2 transition-colors hover:text-blue-300"
        >
          {node.children.map((c, i) =>
            renderAstNode(c, i, previewUrlMap, missingPaths),
          )}
        </a>
      );

    case 'table':
      return (
        <div key={key} className="my-4 overflow-x-auto">
          <table className="w-full border-collapse border border-neutral-800 text-left text-xs">
            {node.children.map((c, i) =>
              renderAstNode(c, i, previewUrlMap, missingPaths),
            )}
          </table>
        </div>
      );

    case 'tableRow':
      return (
        <tr
          key={key}
          className="border-b border-neutral-800 transition-colors even:bg-neutral-950/40"
        >
          {node.children.map((c, i) =>
            renderAstNode(c, i, previewUrlMap, missingPaths),
          )}
        </tr>
      );

    case 'tableCell':
      return (
        <td
          key={key}
          className="border border-neutral-800 p-2.5 text-neutral-300"
        >
          {node.children.map((c, i) =>
            renderAstNode(c, i, previewUrlMap, missingPaths),
          )}
        </td>
      );

    case 'thematicBreak':
      return <hr key={key} className="my-6 border-neutral-800" />;

    default: {
      const parentNode = node as { children?: RootContent[] };
      if ('children' in node && Array.isArray(parentNode.children)) {
        return (
          <div key={key}>
            {parentNode.children.map((child: RootContent, i: number) =>
              renderAstNode(child, i, previewUrlMap, missingPaths),
            )}
          </div>
        );
      }
      return null;
    }
  }
}

/**
 * 解決済みBlob URLを差し替えてMarkdownのローカルプレビューを描画するコンポーネント。
 * ※ 本コンポーネントはアップロード前の画像配置・突合状態を視覚確認するための軽量プレビュー。
 * GFMの本格的なHTMLレンダリング(構文ハイライト・数式・アンカー生成など)は閲覧画面側で処理する。
 *
 * @param props - コンポーネントのプロパティ。
 * @returns プレビュー表示UI。
 */
export function MarkdownPreview({
  title,
  ast,
  previewUrlMap,
  missingPaths = new Set(),
}: MarkdownPreviewProps) {
  if (!ast || ast.children.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-800 p-8 text-center text-xs text-neutral-500">
        プレビュー対象のコンテンツがありません。
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-6 sm:p-8">
      {title && (
        <div className="mb-6 border-b border-neutral-800 pb-4">
          <span className="text-[11px] font-semibold tracking-wider text-blue-400 uppercase">
            Document Preview
          </span>
          <h1 className="mt-1 text-2xl font-bold text-neutral-100">{title}</h1>
        </div>
      )}

      <article className="prose max-w-none text-sm text-neutral-200 prose-invert">
        {renderAstNode(ast, 0, previewUrlMap, missingPaths)}
      </article>
    </div>
  );
}
