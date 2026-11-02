import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  MAX_SINGLE_FILE_SIZE,
  type AllowedImageMimeType,
} from '@patto-md/shared';
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

/** OSのシステム領域および予約パスのプレフィックス一覧。 */
const SYSTEM_RESERVED_PREFIXES = [
  '/etc',
  '/bin',
  '/sbin',
  '/dev',
  '/proc',
  '/sys',
  '/private',
  '/System',
  '/Library',
  '/usr',
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
];

/** 機密性の高いディレクトリ名一覧。パスセグメントに含まれている場合はアクセスを拒絶する。 */
const SENSITIVE_DIRECTORY_NAMES = new Set([
  '.ssh',
  '.gnupg',
  '.aws',
  '.config',
  '.env',
  '.git',
]);

/**
 * ディレクトリ階層を上位へ遡り、Gitルート(`.git`)またはプロジェクトルート(`package.json`)を探索する。
 *
 * @param startDir - 探索開始ディレクトリ。
 * @returns 検出されたプロジェクトルートの絶対パス。見つからない場合は `null`。
 */
export function findProjectRoot(startDir: string): string | null {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;

  while (current && current !== root) {
    try {
      const gitPath = path.join(current, '.git');
      const pkgPath = path.join(current, 'package.json');
      if (fsSync.existsSync(gitPath) || fsSync.existsSync(pkgPath)) {
        return current;
      }
    } catch {
      /* 権限エラー等はスキップして上位を探索 */
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return null;
}

/**
 * パスがシステム領域や機密パスに触れておらず、安全なスコープ内に収まっているかを検証する。
 *
 * 検証基準:
 * 1. OSルートそのものでないこと。
 * 2. 許可された画像拡張子(MIME)であること。
 * 3. OSのシステム予約パス(`/etc`, `/System`, `C:\Windows` 等)でないこと。
 * 4. 機密ディレクトリセグメント(`.ssh`, `.gnupg`, `.aws` 等)を含まないこと。
 * 5. スコープ境界:
 *    - Gitルートまたはプロジェクトルートが存在する場合、その境界配下に収まっていること。
 *    - プロジェクト外の場合は、基準ディレクトリ(`baseDir`)またはカレントディレクトリ(`cwd`)の配下、
 *      もしくは過度な遡及(ホームディレクトリ外やシステムルート直下)を行っていないこと。
 *
 * @param resolvedPath - 解決された絶対パス。
 * @param baseDir - 基準ディレクトリ。
 * @returns 安全と判断される場合は `true`、それ以外は `false`。
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

  const normalizedPath = path.normalize(resolvedPath);
  for (const prefix of SYSTEM_RESERVED_PREFIXES) {
    if (
      normalizedPath === prefix ||
      normalizedPath.startsWith(`${prefix}${path.sep}`) ||
      normalizedPath
        .toLowerCase()
        .startsWith(`${prefix.toLowerCase()}${path.sep}`)
    ) {
      return false;
    }
  }

  const segments = normalizedPath.split(path.sep);
  for (const segment of segments) {
    if (SENSITIVE_DIRECTORY_NAMES.has(segment)) {
      return false;
    }
  }

  const cwd = process.cwd();
  const projectRoot = findProjectRoot(baseDir) ?? findProjectRoot(cwd);

  if (projectRoot) {
    const relFromRoot = path.relative(projectRoot, normalizedPath);
    if (!relFromRoot.startsWith('..') && !path.isAbsolute(relFromRoot)) {
      return true;
    }
  }

  const relFromBase = path.relative(baseDir, normalizedPath);
  const relFromCwd = path.relative(cwd, normalizedPath);

  if (!relFromBase.startsWith('..') || !relFromCwd.startsWith('..')) {
    return true;
  }

  const homedir = os.homedir();
  if (homedir) {
    const relFromHome = path.relative(homedir, normalizedPath);
    if (relFromHome.startsWith('..') || path.isAbsolute(relFromHome)) {
      return false;
    }
  }

  const parentOfBase = path.dirname(baseDir);
  const relFromParent = path.relative(parentOfBase, normalizedPath);
  if (relFromParent.startsWith('..')) {
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
 * 同一の実体ファイルへの複数参照(表記ゆれや同一画像の再利用など)は、
 * ローカル絶対パス(`absolutePath`)をキーとして自動的に重複排除され、
 * アセット実体ごとにユニーク化された上で参照元パス一覧(`originalPaths`)が紐付けられる。
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

  const candidateMap = new Map<
    string,
    {
      absolutePath: string;
      originalPath: string;
      originalPaths: string[];
      mimeType: AllowedImageMimeType;
    }
  >();
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

    const existing = candidateMap.get(absolutePath);
    if (existing) {
      if (!existing.originalPaths.includes(rawPath)) {
        existing.originalPaths.push(rawPath);
      }
    } else {
      candidateMap.set(absolutePath, {
        absolutePath,
        originalPath: rawPath,
        originalPaths: [rawPath],
        mimeType,
      });
    }
  }

  const fileReadPromises = Array.from(candidateMap.values()).map(
    async (candidate) => {
      try {
        const stats = await fs.stat(candidate.absolutePath);
        if (!stats.isFile()) {
          for (const rawPath of candidate.originalPaths) {
            missingPaths.push(rawPath);
          }
          return null;
        }

        if (stats.size > MAX_SINGLE_FILE_SIZE) {
          for (const rawPath of candidate.originalPaths) {
            invalidPaths.push({
              path: rawPath,
              reason: `単一ファイルサイズ制限(10MB)を超過しています: ${(stats.size / 1024 / 1024).toFixed(2)}MB`,
            });
          }
          return null;
        }

        const buffer = await fs.readFile(candidate.absolutePath);
        const fileName = path.basename(candidate.absolutePath);

        const asset: LocalAssetItem = {
          originalPath: candidate.originalPath,
          originalPaths: candidate.originalPaths,
          absolutePath: candidate.absolutePath,
          fileName,
          size: stats.size,
          mimeType: candidate.mimeType,
          buffer,
        };
        return asset;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          for (const rawPath of candidate.originalPaths) {
            missingPaths.push(rawPath);
          }
        } else {
          for (const rawPath of candidate.originalPaths) {
            invalidPaths.push({
              path: rawPath,
              reason: `ファイル読み込みに失敗しました: ${(error as Error).message}`,
            });
          }
        }
        return null;
      }
    },
  );

  const readResults = await Promise.all(fileReadPromises);
  const assets: LocalAssetItem[] = readResults.filter(
    (asset): asset is LocalAssetItem => asset !== null,
  );

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
