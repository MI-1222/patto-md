import type { Root } from 'mdast';
import type { ExtractedImageRef } from './types';
import type { VirtualFile } from '../../components/dropzone/types';

/**
 * 照合に成功した解決済み画像の型定義。
 */
export interface ResolvedAsset {
  /** Markdown内で要求されている正規化済み相対パス(例: `"images/fig.png"`)。 */
  cleanPath: string;
  /** 紐付いたファイル実体。 */
  file: File;
  /** 仮想ファイル上の登録相対パス。 */
  relativePath: string;
  /** 照合の一致種別。 */
  matchType: 'exact' | 'suffix' | 'case-insensitive' | 'basename';
  /** 当該画像を参照しているASTノード情報群。 */
  refs: ExtractedImageRef[];
}

/**
 * 照合に失敗した未解決画像の型定義。
 */
export interface MissingAsset {
  /** 見つからなかった正規化済み相対パス。 */
  cleanPath: string;
  /** 当該画像を参照しているASTノード情報群(出現行や `alt` テキストなど)。 */
  refs: ExtractedImageRef[];
  /** 未解決の理由。 */
  reason: 'not_found' | 'ambiguous_basename';
  /** 同名候補が存在した場合の相対パス一覧。 */
  candidatePaths?: string[];
}

/**
 * Markdown内から一度も参照されていない余剰画像の型定義。
 */
export interface UnusedAsset {
  /** 仮想ファイル上の登録相対パス。 */
  relativePath: string;
  /** ファイル実体。 */
  file: File;
}

/**
 * 突合処理の最終結果インターフェース。
 */
export interface ReconciliationResult {
  /** 解決済み画像マップ(キー: `cleanPath`)。 */
  resolved: Map<string, ResolvedAsset>;
  /** 未解決画像リスト。 */
  missing: MissingAsset[];
  /** 余剰(未使用)画像リスト。 */
  unused: UnusedAsset[];
  /** すべての参照が解決されたかどうかの真偽値。 */
  isComplete: boolean;
  /** 解決されたユニークな画像数。 */
  totalResolvedCount: number;
  /** 要求された全画像参照ノードの総数。 */
  totalRefsCount: number;
}

/**
 * ファイルパスから末尾のファイル名(ベース名)を取得する。
 *
 * @param path - ファイルパス文字列。
 * @returns ファイル名。
 */
export function getBasename(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const lastSlashIndex = normalized.lastIndexOf('/');
  return lastSlashIndex === -1
    ? normalized
    : normalized.slice(lastSlashIndex + 1);
}

/**
 * 文字列をNFC正規化し、`Windows` パス区切りを統一する。
 *
 * @param str - 対象の文字列。
 * @returns 正規化済みの文字列。
 */
function normalizeString(str: string): string {
  return str.normalize('NFC').replace(/\\/g, '/').trim();
}

/**
 * Markdown ASTから抽出された画像参照群と、ドロップされた仮想ファイルマップを突合する。
 * 優先順位:
 * 1. 完全相対パス一致
 * 2. パス末尾サフィックス一致(ルートフォルダ差異の吸収)
 * 3. 大文字小文字無視一致
 * 4. ファイル名(ベース名)単体一致(同名が1件の場合のみ救済)
 *
 * @param imageRefs - AST走査で抽出された画像参照リスト。
 * @param assetFiles - ドロップされた添付アセットファイルマップまたは配列。
 * @returns 突合判定結果。
 */
export function reconcileAssets(
  imageRefs: ExtractedImageRef[],
  assetFiles: Map<string, VirtualFile> | VirtualFile[],
): ReconciliationResult {
  const fileList: VirtualFile[] =
    assetFiles instanceof Map ? Array.from(assetFiles.values()) : assetFiles;

  // 1. ルックアップ用インデックスの構築。
  const exactMap = new Map<string, VirtualFile>();
  const caseInsensitiveMap = new Map<string, VirtualFile[]>();
  const basenameMap = new Map<string, VirtualFile[]>();

  for (const item of fileList) {
    const normPath = normalizeString(item.relativePath);
    exactMap.set(normPath, item);

    const lowerPath = normPath.toLowerCase();
    const existingLower = caseInsensitiveMap.get(lowerPath) || [];
    existingLower.push(item);
    caseInsensitiveMap.set(lowerPath, existingLower);

    const baseName = normalizeString(
      getBasename(item.relativePath),
    ).toLowerCase();
    const existingBase = basenameMap.get(baseName) || [];
    existingBase.push(item);
    basenameMap.set(baseName, existingBase);
  }

  // 2. `cleanPath` ごとに参照ノードをグループ化する。
  const refsByCleanPath = new Map<string, ExtractedImageRef[]>();
  for (const ref of imageRefs) {
    const normCleanPath = normalizeString(ref.cleanPath);
    const group = refsByCleanPath.get(normCleanPath) || [];
    group.push(ref);
    refsByCleanPath.set(normCleanPath, group);
  }

  const resolved = new Map<string, ResolvedAsset>();
  const missing: MissingAsset[] = [];
  const usedRelativePaths = new Set<string>();

  // 3. 各画像参照パスの照合処理。
  for (const [cleanPath, refs] of refsByCleanPath.entries()) {
    // 優先度1: 完全一致。
    if (exactMap.has(cleanPath)) {
      const match = exactMap.get(cleanPath)!;
      resolved.set(cleanPath, {
        cleanPath,
        file: match.file,
        relativePath: match.relativePath,
        matchType: 'exact',
        refs,
      });
      usedRelativePaths.add(normalizeString(match.relativePath));
      continue;
    }

    // 優先度2: 末尾サフィックス一致(例: ドロップが `"folder/images/pic.png"` で `cleanPath` が `"images/pic.png"`)。
    const suffixCandidates: VirtualFile[] = [];
    const targetSuffix = `/${cleanPath}`;
    for (const [normPath, file] of exactMap.entries()) {
      if (normPath.endsWith(targetSuffix)) {
        suffixCandidates.push(file);
      }
    }
    if (suffixCandidates.length === 1) {
      const match = suffixCandidates[0];
      resolved.set(cleanPath, {
        cleanPath,
        file: match.file,
        relativePath: match.relativePath,
        matchType: 'suffix',
        refs,
      });
      usedRelativePaths.add(normalizeString(match.relativePath));
      continue;
    }

    // 優先度3: 大文字小文字無視一致。
    const lowerClean = cleanPath.toLowerCase();
    const caseCandidates = caseInsensitiveMap.get(lowerClean) || [];
    if (caseCandidates.length === 1) {
      const match = caseCandidates[0];
      resolved.set(cleanPath, {
        cleanPath,
        file: match.file,
        relativePath: match.relativePath,
        matchType: 'case-insensitive',
        refs,
      });
      usedRelativePaths.add(normalizeString(match.relativePath));
      continue;
    }

    // 優先度4: ファイル名(ベース名)単体一致。
    const baseName = normalizeString(getBasename(cleanPath)).toLowerCase();
    const baseCandidates = basenameMap.get(baseName) || [];

    if (baseCandidates.length === 1) {
      const match = baseCandidates[0];
      resolved.set(cleanPath, {
        cleanPath,
        file: match.file,
        relativePath: match.relativePath,
        matchType: 'basename',
        refs,
      });
      usedRelativePaths.add(normalizeString(match.relativePath));
      continue;
    }

    if (baseCandidates.length > 1) {
      // 同名ファイルが複数存在するため衝突(曖昧)として未解決扱いにする。
      missing.push({
        cleanPath,
        refs,
        reason: 'ambiguous_basename',
        candidatePaths: baseCandidates.map((c) => c.relativePath),
      });
      continue;
    }

    // 該当なし: 未解決。
    missing.push({
      cleanPath,
      refs,
      reason: 'not_found',
    });
  }

  // 4. 一度も参照されなかった余剰ファイルの抽出。
  const unused: UnusedAsset[] = [];
  for (const item of fileList) {
    const norm = normalizeString(item.relativePath);
    if (!usedRelativePaths.has(norm)) {
      unused.push({
        relativePath: item.relativePath,
        file: item.file,
      });
    }
  }

  return {
    resolved,
    missing,
    unused,
    isComplete: missing.length === 0,
    totalResolvedCount: resolved.size,
    totalRefsCount: imageRefs.length,
  };
}

/**
 * プレビュー用URLマップを用いてMDAST構文木の画像URLを置換したクローンASTを生成する。
 * 元の構文木は破壊せず不変性を保つ。
 *
 * @param ast - 原本MDAST構文木ルート。
 * @param previewUrlMap - `cleanPath` または `rawUrl` から `blob: URL` へのマッピングテーブル。
 * @returns プレビュー用URLが注入された新しいMDAST構文木。
 */
export function cloneAstWithPreviewUrls(
  ast: Root,
  previewUrlMap: Map<string, string>,
): Root {
  const cloned = structuredClone(ast);

  function walk(node: unknown) {
    if (!node || typeof node !== 'object') {
      return;
    }

    const n = node as Record<string, unknown>;

    if (n.type === 'image' || n.type === 'definition') {
      const currentUrl = typeof n.url === 'string' ? n.url : '';
      // クエリやハッシュを除いたパスで照合する。
      const cleanKey = normalizeString(
        currentUrl.split(/[?#]/)[0].replace(/^(\.\/|\/)+/, ''),
      );
      const replacementUrl =
        previewUrlMap.get(cleanKey) || previewUrlMap.get(currentUrl);

      if (replacementUrl) {
        n.url = replacementUrl;
      }
    }

    if (Array.isArray(n.children)) {
      for (const child of n.children) {
        walk(child);
      }
    }
  }

  walk(cloned);
  return cloned;
}

/**
 * 正規表現特殊文字をエスケープする。
 *
 * @param str - エスケープ対象文字列。
 * @returns エスケープ後の文字列。
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 置換作業対象のノードスライス情報インターフェース。 */
interface ReplacementTask {
  startOffset: number;
  endOffset: number;
  targetUrl: string;
  replacementUrl: string;
}

/**
 * Markdown生テキスト内の画像URL文字列を安全に置換する。
 * ASTノードの位置情報(`position` の `start/end offset`)に基づき、ノードの記述範囲内のみを後方から順にスライス置換する。
 * 本文テキストやコードブロック内の同名文字列(例: `"icon.png"`)への誤置換を防ぐ。
 * オフセットが取得できない場合は、Markdown画像構文に絞った正規表現置換でフォールバックする。
 *
 * @param content - 原本Markdown生テキスト。
 * @param imageRefs - 抽出された画像参照情報一覧。
 * @param urlMap - 置換先URLマップ(キー: `cleanPath`)。
 * @returns 画像URLが置換されたMarkdownテキスト。
 */
export function replaceMarkdownImageUrls(
  content: string,
  imageRefs: ExtractedImageRef[],
  urlMap: Map<string, string>,
): string {
  if (imageRefs.length === 0) {
    return content;
  }

  // 1. オフセット情報を持つ置換タスクを抽出する。
  const tasks: ReplacementTask[] = [];
  const processedNodePositions = new Set<string>();
  const fallbackRefs: ExtractedImageRef[] = [];

  for (const ref of imageRefs) {
    const replacement = urlMap.get(normalizeString(ref.cleanPath));
    if (!replacement) {
      continue;
    }

    const newUrl = `${replacement}${ref.queryParams}`;
    const targetUrl = ref.rawUrl;

    // `position` の `start/end offset` を確認。
    // `definition` ノードの場合は `ref.node.position`、標準画像の場合は `ref.position` を利用する。
    const pos = ref.node.position || ref.position;

    if (
      pos?.start?.offset !== undefined &&
      pos?.end?.offset !== undefined &&
      pos.start.offset >= 0 &&
      pos.end.offset <= content.length &&
      pos.start.offset < pos.end.offset
    ) {
      const posKey = `${pos.start.offset}-${pos.end.offset}`;
      if (!processedNodePositions.has(posKey)) {
        processedNodePositions.add(posKey);
        tasks.push({
          startOffset: pos.start.offset,
          endOffset: pos.end.offset,
          targetUrl,
          replacementUrl: newUrl,
        });
      }
    } else {
      fallbackRefs.push(ref);
    }
  }

  let result = content;

  // 2. オフセットが存在するノードは、末尾(オフセットの降順)からスライス置換する。
  // 後方から置換することで、前方ノードの文字インデックスのずれを防止する。
  tasks.sort((a, b) => b.startOffset - a.startOffset);

  for (const task of tasks) {
    const nodeText = result.slice(task.startOffset, task.endOffset);
    const targetIndex = nodeText.indexOf(task.targetUrl);
    if (targetIndex !== -1) {
      const beforeTarget = nodeText.slice(0, targetIndex);
      const afterTarget = nodeText.slice(targetIndex + task.targetUrl.length);
      const updatedNodeText = `${beforeTarget}${task.replacementUrl}${afterTarget}`;

      result = `${result.slice(0, task.startOffset)}${updatedNodeText}${result.slice(task.endOffset)}`;
    }
  }

  // 3. オフセット情報が欠落しているノードに対する安全なフォールバック正規表現置換。
  for (const ref of fallbackRefs) {
    const replacement = urlMap.get(normalizeString(ref.cleanPath));
    if (!replacement) {
      continue;
    }
    const newUrl = `${replacement}${ref.queryParams}`;
    const escapedTarget = escapeRegex(ref.rawUrl);

    // インライン画像構文: `![alt](rawUrl)`
    const inlineImageRegex = new RegExp(
      `(!\\[[^\\]]*\\]\\(\\s*)${escapedTarget}(\\s*(?:\\"[^\\"]*\\"|'[^']*')?\\))`,
      'g',
    );
    result = result.replace(inlineImageRegex, `$1${newUrl}$2`);

    // 参照形式リンク定義構文: `[id]: rawUrl`
    const definitionRegex = new RegExp(
      `(^\\s*\\[[^\\]]+\\]:\\s*)${escapedTarget}(\\s*(?:\\"[^\\"]*\\"|'[^']*')?$)`,
      'gm',
    );
    result = result.replace(definitionRegex, `$1${newUrl}$2`);
  }

  return result;
}
