import fs from 'node:fs/promises';
import path from 'node:path';
import { MAX_SINGLE_FILE_SIZE } from '@patto-md/shared';
import type { LocalAssetItem } from '../types.ts';
import { resolveImageMimeType } from './mime.ts';

/** Markdown画像記法に一致する正規表現。 */
const MD_IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;

/** HTML img タグに一致する正規表現。 */
const HTML_IMAGE_REGEX = /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;

/** Markdown先頭の H1 見出しに一致する正規表現。 */
const FIRST_H1_REGEX = /^\s*#\s+(.+)$/m;

/**
 * Markdown本文またはファイル名からドキュメントタイトルを抽出する。
 *
 * 優先順位:
 * 1. Markdown本文先頭の `# タイトル`
 * 2. 提供されたファイル名(拡張子を除去したもの)
 * 3. 既定値 `'Untitled'`
 *
 * @param content - Markdown本文。
 * @param filePath - Markdownファイルパス。
 * @returns 抽出されたタイトル文字列。
 */
export function extractTitle(content: string, filePath?: string): string {
  const match = FIRST_H1_REGEX.exec(content);
  if (match && match[1]) {
    const title = match[1].trim();
    if (title.length > 0) {
      return title;
    }
  }

  if (filePath) {
    const basename = path.basename(filePath);
    const parsedName = basename.replace(/\.(md|markdown)$/i, '').trim();
    if (parsedName.length > 0) {
      return parsedName;
    }
  }

  return 'Untitled';
}

/**
 * 文字列が外部URLまたはインライン画像(Data URI)であるかを判定する。
 *
 * @param url - 判定対象のURL文字列。
 * @returns 外部URLまたはインラインデータの場合は `true`。
 */
export function isExternalOrInlineUrl(url: string): boolean {
  const trimmed = url.trim();
  return (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('data:')
  );
}

/**
 * 画像パスから前後の空白、Markdownタイトル属性、クエリパラメータ、フラグメントを除去し、URLデコードを行う。
 *
 * @param rawPath - 元のパス文字列。
 * @returns クリーンアップ済みの相対パス。
 */
export function cleanRelativePath(rawPath: string): string {
  const withoutTitle = rawPath
    .trim()
    .split(/\s+["'][^"']*["']$/)[0]
    .trim();
  const clean = withoutTitle.split(/[?#]/)[0];
  try {
    return decodeURIComponent(clean);
  } catch {
    return clean;
  }
}

/**
 * パスが安全なスコープ内に収まっているかを検証する。
 * OSルートパスへのアクセス(`root` そのもの)の拒絶、許可された画像拡張子の確認、
 * カレントディレクトリおよびベースディレクトリから4階層以上離脱するパストラバーサルを防止する。
 *
 * @param resolvedPath - 解決された絶対パス。
 * @param baseDir - 基準ディレクトリ。
 * @returns 安全と判断される場合は `true`。
 */
export function isSafePath(resolvedPath: string, baseDir: string): boolean {
  const root = path.parse(resolvedPath).root;
  if (resolvedPath === root) {
    return false;
  }

  const mimeType = resolveImageMimeType(resolvedPath);
  if (!mimeType) {
    return false;
  }

  const cwd = process.cwd();
  const relFromBase = path.relative(baseDir, resolvedPath);
  const relFromCwd = path.relative(cwd, resolvedPath);

  if (!relFromBase.startsWith('..') || !relFromCwd.startsWith('..')) {
    return true;
  }

  if (
    relFromBase.startsWith('../../../../') &&
    relFromCwd.startsWith('../../../../')
  ) {
    return false;
  }

  return true;
}

/** 相対画像パス解析およびローカルファイル実体解決の結果。 */
export interface ResolvedAssetsResult {
  /** 解決に成功したアセット情報一覧。 */
  assets: LocalAssetItem[];
  /** 存在しなかった未解決画像パス一覧。 */
  missingPaths: string[];
  /** 容量上限やパストラバーサルなどの理由で拒絶された不正パス一覧。 */
  invalidPaths: Array<{ path: string; reason: string }>;
}

/**
 * Markdown本文内から相対画像パスを抽出し、ローカルファイル実体を読み込んで検証する。
 *
 * @param markdownContent - 解析対象のMarkdown本文。
 * @param markdownFilePath - 対象Markdownファイルのローカル絶対パスまたは相対パス。
 * @returns 解決結果(正常アセット、欠落パス、不正パス)。
 */
export async function extractAndResolveAssets(
  markdownContent: string,
  markdownFilePath: string,
): Promise<ResolvedAssetsResult> {
  const baseDir = path.dirname(path.resolve(markdownFilePath));
  const rawPathSet = new Set<string>();

  let mdMatch: RegExpExecArray | null;
  const mdRegex = new RegExp(MD_IMAGE_REGEX.source, MD_IMAGE_REGEX.flags);
  while ((mdMatch = mdRegex.exec(markdownContent)) !== null) {
    const rawPath = mdMatch[2];
    if (rawPath && !isExternalOrInlineUrl(rawPath)) {
      rawPathSet.add(rawPath.trim());
    }
  }

  let htmlMatch: RegExpExecArray | null;
  const htmlRegex = new RegExp(HTML_IMAGE_REGEX.source, HTML_IMAGE_REGEX.flags);
  while ((htmlMatch = htmlRegex.exec(markdownContent)) !== null) {
    const rawPath = htmlMatch[1];
    if (rawPath && !isExternalOrInlineUrl(rawPath)) {
      rawPathSet.add(rawPath.trim());
    }
  }

  const assets: LocalAssetItem[] = [];
  const missingPaths: string[] = [];
  const invalidPaths: Array<{ path: string; reason: string }> = [];

  for (const rawPath of rawPathSet) {
    const cleanedPath = cleanRelativePath(rawPath);
    if (!cleanedPath) {
      continue;
    }

    const absolutePath = path.resolve(baseDir, cleanedPath);

    if (!isSafePath(absolutePath, baseDir)) {
      invalidPaths.push({
        path: rawPath,
        reason: '安全でないパス、または許可されていない拡張子です。',
      });
      continue;
    }

    const mimeType = resolveImageMimeType(absolutePath);
    if (!mimeType) {
      invalidPaths.push({
        path: rawPath,
        reason: '対応していない画像フォーマットです。',
      });
      continue;
    }

    try {
      const stats = await fs.stat(absolutePath);
      if (!stats.isFile()) {
        missingPaths.push(rawPath);
        continue;
      }

      if (stats.size > MAX_SINGLE_FILE_SIZE) {
        invalidPaths.push({
          path: rawPath,
          reason: `単一ファイルサイズ制限(10MB)を超過しています: ${(stats.size / 1024 / 1024).toFixed(2)}MB`,
        });
        continue;
      }

      const buffer = await fs.readFile(absolutePath);
      const fileName = path.basename(absolutePath);

      assets.push({
        originalPath: rawPath,
        absolutePath,
        fileName,
        size: stats.size,
        mimeType,
        buffer,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        missingPaths.push(rawPath);
      } else {
        invalidPaths.push({
          path: rawPath,
          reason: `ファイル読み込みに失敗しました: ${(error as Error).message}`,
        });
      }
    }
  }

  return {
    assets,
    missingPaths,
    invalidPaths,
  };
}

/** 正規表現用の特殊文字をエスケープする。 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Markdown本文内の相対画像パスを、永続アセットURL (`/api/assets/${r2Key}`) に置換する。
 *
 * 本文中の平文テキストへの誤爆や多重置換を防止するため、
 * Markdown画像記法 (`![alt](path)`) および HTML属性 (`src="path"`) のコンテキストに限定して置換を行う。
 * また、部分一致による干渉を防ぐため、パス長の降順でソートして適用する。
 *
 * @param markdownContent - 元のMarkdown本文。
 * @param pathMapping - 元の相対画像パスと永続アセットURLのマッピング (`Map<originalPath, permanentUrl>`)。
 * @returns 置換後のMarkdown本文。
 */
export function replaceMarkdownImageUrls(
  markdownContent: string,
  pathMapping: Map<string, string>,
): string {
  if (!markdownContent || pathMapping.size === 0) {
    return markdownContent;
  }

  let result = markdownContent;

  const sortedEntries = Array.from(pathMapping.entries()).sort(
    (a, b) => b[0].length - a[0].length,
  );

  for (const [originalPath, permanentUrl] of sortedEntries) {
    const trimmed = originalPath.trim();
    if (!trimmed) {
      continue;
    }

    const withoutDotSlash = trimmed.startsWith('./')
      ? trimmed.slice(2)
      : trimmed;
    const withDotSlash = trimmed.startsWith('./') ? trimmed : `./${trimmed}`;

    const variants = Array.from(
      new Set([trimmed, withoutDotSlash, withDotSlash, encodeURI(trimmed)]),
    );

    for (const variant of variants) {
      const escaped = escapeRegExp(variant);

      const mdRegex = new RegExp(
        `(!\\[[^\\]]*\\]\\()\\s*${escaped}(?:(\\s+["'][^"']*["']))?\\s*(\\))`,
        'g',
      );
      result = result.replace(
        mdRegex,
        (_match, prefix: string, title = '', suffix: string) => {
          return `${prefix}${permanentUrl}${title}${suffix}`;
        },
      );

      const attrRegex = new RegExp(
        `((?:\\bsrc=["']))\\s*${escaped}\\s*(["'])`,
        'gi',
      );
      result = result.replace(attrRegex, `$1${permanentUrl}$2`);
    }
  }

  return result;
}
