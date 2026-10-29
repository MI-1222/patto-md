import type { Root, Image, Definition } from 'mdast';
import type { Position } from 'unist';

/** 抽出された単一の画像参照情報インターフェース。 */
export interface ExtractedImageRef {
  /** Markdown内の生URL記述(例: "./assets/foo.png?v=1#hash")。 */
  rawUrl: string;
  /** 突合用に正規化された相対パス(例: "assets/foo.png")。 */
  cleanPath: string;
  /** 分離されたクエリパラメータおよびハッシュフラグメント(例: "?v=1#hash")。 */
  queryParams: string;
  /** 画像の代替テキスト(alt)。未指定時はnull。 */
  alt: string | null;
  /** 画像のtitle属性。未指定時はnull。 */
  title: string | null;
  /** AST内の対象ノード参照(URL置換処理用)。 */
  node: Image | Definition;
  /** ソースコード上の位置情報。 */
  position?: Position;
}

/** Markdown AST解析パイプラインの解析結果インターフェース。 */
export interface MarkdownParseResult {
  /** 生成されたMDAST構文木のルートノード。 */
  ast: Root;
  /** 抽出されたローカル画像参照のリスト。 */
  imageRefs: ExtractedImageRef[];
  /** 重複排除された解決対象の相対パス一覧。 */
  uniqueAssetPaths: string[];
  /** 本文先頭のH1から抽出されたタイトル候補(存在しない場合はnull)。 */
  title: string | null;
  /** スキップされた外部URL画像参照の件数。 */
  externalImageCount: number;
}

/** Markdown解析オプションインターフェース。 */
export interface ParseMarkdownOptions {
  /**
   * ドロップされたMarkdownファイル自身の相対パス(例: "docs/readme.md")。
   * 画像の相対パス解決の基準ディレクトリとして使用する。
   */
  basePath?: string;
  /** H1見出しが存在しない場合のフォールバックタイトル(例: ファイル名)。 */
  fallbackTitle?: string;
}
