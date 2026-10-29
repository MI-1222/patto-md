/**
 * ドロップゾーン関連の型定義および状態定義。
 */

/**
 * 仮想ファイル情報インターフェース。
 * 相対パス情報を保持する。
 */
export interface VirtualFile {
  /** ファイル実体。 */
  file: File;
  /** 相対パス(例: "images/screenshot.png" または "README.md")。 */
  relativePath: string;
  /** 単一ファイルサイズ制約エラーの有無。 */
  isSizeExceeded: boolean;
  /** 未許可MIMEタイプエラーの有無。 */
  isTypeUnsupported: boolean;
}

/** 分類済みファイル群インターフェース。 */
export interface ParsedFiles {
  /** 主Markdownファイル(複数ドロップされた場合は最初のMarkdown)。 */
  markdownFile: VirtualFile | null;
  /** 添付アセットファイルマップ(キー: 相対パス)。 */
  assetFiles: Map<string, VirtualFile>;
  /** 全ファイルの合計サイズ(バイト単位)。 */
  totalSize: number;
  /** 合計ファイルサイズ制約エラーの有無。 */
  isTotalSizeExceeded: boolean;
  /** 無効なファイルが含まれているかどうかのフラグ。 */
  hasInvalidFiles: boolean;
}

/** ドロップゾーンのインタラクション状態型。 */
export type DropZoneStatus = 'idle' | 'dragover' | 'ready';
