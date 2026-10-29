/**
 * ブラウザ環境向けのパス正規化およびURL判定ユーティリティ。
 * Node.js組み込みモジュールに依存せず、Pure TypeScriptで動作する。
 */

/**
 * 外部URLや特殊スキーム(http, https, data, blob, mailto等)であるかを判定する。
 *
 * @param url - 判定対象のURL文字列。
 * @returns 外部リソースまたはスキップ対象の場合はtrue。
 */
export function isExternalUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) {
    return true;
  }

  // プロトコル相対URLおよびページ内アンカーの除外。
  if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
    return true;
  }

  // 一般的なURIスキーム構文(http:, https:, data:, blob:, mailto: 等)の検出。
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
}

/**
 * URL文字列をパス部分とクエリ・ハッシュ部分に分離する。
 *
 * @param url - 対象URL文字列。
 * @returns パス部分とパラメータ部分のオブジェクト。
 */
export function splitUrl(url: string): {
  pathname: string;
  queryAndHash: string;
} {
  const queryIndex = url.indexOf('?');
  const hashIndex = url.indexOf('#');

  let splitIndex = -1;
  if (queryIndex !== -1 && hashIndex !== -1) {
    splitIndex = Math.min(queryIndex, hashIndex);
  } else if (queryIndex !== -1) {
    splitIndex = queryIndex;
  } else if (hashIndex !== -1) {
    splitIndex = hashIndex;
  }

  if (splitIndex === -1) {
    return { pathname: url, queryAndHash: '' };
  }

  return {
    pathname: url.slice(0, splitIndex),
    queryAndHash: url.slice(splitIndex),
  };
}

/**
 * 安全にパーセントエンコーディングをデコードする。
 * 不正なエンコーディングが含まれていても例外を送出せずフォールバックする。
 *
 * @param str - デコード対象文字列。
 * @returns デコード後の文字列。
 */
export function safeDecodeUri(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch {
    try {
      return decodeURI(str);
    } catch {
      return str;
    }
  }
}

/**
 * ファイルパスから配置ディレクトリ(親ディレクトリパス)を抽出する。
 *
 * @param filePath - ファイル相対パス(例: "docs/architecture/readme.md")。
 * @returns 親ディレクトリパス(例: "docs/architecture")。最上位の場合は空文字。
 */
export function resolveBaseDirectory(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const lastSlashIndex = normalized.lastIndexOf('/');
  if (lastSlashIndex === -1) {
    return '';
  }
  return normalized.slice(0, lastSlashIndex);
}

/**
 * 画像の相対参照パスを正規化し、仮想ファイルマップとの照合用パスを生成する。
 *
 * @param rawUrl - Markdown内に記述された画像URL文字列(例: "./images/photo%201.png?v=1")。
 * @param baseFilePath - ドロップされたMarkdownファイル自体の相対パス(例: "notes/doc.md")。
 * @returns 正規化済み相対パスと分離されたクエリパラメータ。
 */
export function normalizeRelativePath(
  rawUrl: string,
  baseFilePath = '',
): { cleanPath: string; queryParams: string } {
  const { pathname, queryAndHash } = splitUrl(rawUrl);

  // Windows区切り文字の統一とデコード処理。
  const decodedPath = safeDecodeUri(pathname).replace(/\\/g, '/').trim();

  // 基準ディレクトリの抽出。
  const baseDir = resolveBaseDirectory(baseFilePath);

  // 先頭スラッシュ(/)で始まるルート相対パスの場合は、baseDirを付与せずルート直下として解決する。
  const isRootRelative = decodedPath.startsWith('/');

  // パスセグメントの結合。
  // 先頭スラッシュ(/)やカレント記号(./)を除去して階層スタックを構築する。
  const combinedPath =
    isRootRelative || !baseDir ? decodedPath : `${baseDir}/${decodedPath}`;
  const rawSegments = combinedPath
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.');

  const resolvedStack: string[] = [];

  for (const segment of rawSegments) {
    if (segment === '..') {
      // ルート階層外へのパストラバーサルを防止するため、スタックが空の場合は無視する。
      if (resolvedStack.length > 0) {
        resolvedStack.pop();
      }
    } else {
      resolvedStack.push(segment);
    }
  }

  return {
    cleanPath: resolvedStack.join('/'),
    queryParams: queryAndHash,
  };
}
