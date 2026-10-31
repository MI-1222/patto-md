/**
 * クライアント側の `localStorage` を用いたケイパビリティトークンの永続化および管理ユーティリティ。
 *
 * 匿名ユーザーが公開・更新したドキュメントの特権トークン(`editToken`)および
 * 本文更新専用トークン(`modifyToken`)を安全にブラウザへ保持し、権限ロールを判定する。
 */
import {
  EDIT_TOKEN_PATTERN,
  MODIFY_TOKEN_PATTERN,
  PASSCODE_AUTH_COOKIE_PREFIX,
  SLUG_PATTERN,
  VIEW_TOKEN_EXPIRATION_SECONDS,
} from '@patto-md/shared';
import { addMyDocumentId } from './myDocuments.ts';

/** `localStorage` の保存キー名。 */
export const DOCUMENT_TOKENS_STORAGE_KEY = 'patto_md_document_tokens';

/** 最大保持トークン件数(LRUパージ上限)。 */
const MAX_STORED_COUNT = 100;

/** ストレージに保持するドキュメントごとのトークンレコード定義。 */
export interface StoredDocumentTokens {
  /** 特権管理トークン(本文更新・有効期限延長・削除が可能)。 */
  editToken?: string;
  /** 本文更新専用トークン(本文更新のみ可能)。 */
  modifyToken?: string;
  /** パスコード照合済み閲覧認可トークン(JWT)。 */
  viewToken?: string;
  /** 保存・更新日時文字列(ISO 8601形式)。 */
  savedAt: string;
}

/** ドキュメントID(`slug`)をキーとするトークンマップ型。 */
export type DocumentTokenMap = Record<string, StoredDocumentTokens>;

/** ドキュメントに対する有効な権限ロール種別。 */
export type DocumentTokenRole = 'edit' | 'modify' | null;

/**
 * `localStorage` からトークンマップ全体を取得する。
 *
 * @returns 保持されているトークンマップ。読み込み失敗時は空オブジェクト。
 */
function readTokenMap(): DocumentTokenMap {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(DOCUMENT_TOKENS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const validMap: DocumentTokenMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!SLUG_PATTERN.test(key) || !value || typeof value !== 'object') {
        continue;
      }

      const record = value as Partial<StoredDocumentTokens>;
      const editToken =
        typeof record.editToken === 'string' &&
        EDIT_TOKEN_PATTERN.test(record.editToken)
          ? record.editToken
          : undefined;
      const modifyToken =
        typeof record.modifyToken === 'string' &&
        MODIFY_TOKEN_PATTERN.test(record.modifyToken)
          ? record.modifyToken
          : undefined;
      const viewToken =
        typeof record.viewToken === 'string' && record.viewToken.length > 0
          ? record.viewToken
          : undefined;

      if (!editToken && !modifyToken && !viewToken) {
        continue;
      }

      const savedAt =
        typeof record.savedAt === 'string'
          ? record.savedAt
          : new Date().toISOString();

      validMap[key] = {
        editToken,
        modifyToken,
        viewToken,
        savedAt,
      };
    }

    return validMap;
  } catch (error) {
    console.warn('localStorage からのトークンマップ読み込みに失敗。', error);
    return {};
  }
}

/**
 * トークンマップ全体を `localStorage` に保存する。
 * 最大保持件数を超過した場合は `savedAt` の最も古いレコードから自動破棄(LRUパージ)する。
 *
 * @param map - 保存対象のトークンマップ。
 */
function writeTokenMap(map: DocumentTokenMap): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const entries = Object.entries(map);

    if (entries.length > MAX_STORED_COUNT) {
      entries.sort(
        (a, b) =>
          new Date(b[1].savedAt).getTime() - new Date(a[1].savedAt).getTime(),
      );
      entries.length = MAX_STORED_COUNT;
    }

    const trimmedMap: DocumentTokenMap = Object.fromEntries(entries);
    window.localStorage.setItem(
      DOCUMENT_TOKENS_STORAGE_KEY,
      JSON.stringify(trimmedMap),
    );
  } catch (error) {
    console.warn('localStorage へのトークンマップ保存に失敗。', error);
  }
}

/**
 * 指定されたドキュメントIDに対応する保持トークンを取得する。
 *
 * @param id - ドキュメントID(`slug`)。
 * @returns 保持されているトークンレコード。未保持または形式不正時は `null`。
 */
export function getDocumentTokens(id: string): StoredDocumentTokens | null {
  if (!id || !SLUG_PATTERN.test(id)) {
    return null;
  }

  const map = readTokenMap();
  return map[id] ?? null;
}

/**
 * 指定されたドキュメントのトークンを保存・更新する。
 * 既存レコードが存在する場合はトークンをマージする。
 * また、一覧画面(自分の投稿)との整合性維持のため `addMyDocumentId` も同期して呼び出す。
 *
 * @param id - ドキュメントID(`slug`)。
 * @param tokens - 保存するトークンペア(`editToken`, `modifyToken`)。
 */
export function saveDocumentTokens(
  id: string,
  tokens: { editToken?: string; modifyToken?: string },
): void {
  if (!id || !SLUG_PATTERN.test(id)) {
    return;
  }

  const validEditToken =
    tokens.editToken && EDIT_TOKEN_PATTERN.test(tokens.editToken)
      ? tokens.editToken
      : undefined;
  const validModifyToken =
    tokens.modifyToken && MODIFY_TOKEN_PATTERN.test(tokens.modifyToken)
      ? tokens.modifyToken
      : undefined;

  if (!validEditToken && !validModifyToken) {
    return;
  }

  const map = readTokenMap();
  const existing = map[id];

  map[id] = {
    editToken: validEditToken ?? existing?.editToken,
    modifyToken: validModifyToken ?? existing?.modifyToken,
    viewToken: existing?.viewToken,
    savedAt: new Date().toISOString(),
  };

  writeTokenMap(map);

  try {
    addMyDocumentId(id);
  } catch (error) {
    console.warn('myDocuments へのドキュメントID追加に失敗。', error);
  }
}

/**
 * 指定されたドキュメントIDのトークンレコードを破棄する。
 *
 * @param id - 削除対象のドキュメントID(`slug`)。
 */
export function removeDocumentTokens(id: string): void {
  if (!id || !SLUG_PATTERN.test(id)) {
    return;
  }

  const map = readTokenMap();
  if (id in map) {
    delete map[id];
    writeTokenMap(map);
  }
}

/**
 * 指定されたドキュメントに対して保持している有効な権限ロールを判定する。
 *
 * @param id - ドキュメントID(`slug`)。
 * @returns `edit`(特権管理者), `modify`(共同編集者), または `null`(権限なし)。
 */
export function getDocumentTokenRole(id: string): DocumentTokenRole {
  const tokens = getDocumentTokens(id);
  if (!tokens) {
    return null;
  }

  if (tokens.editToken && EDIT_TOKEN_PATTERN.test(tokens.editToken)) {
    return 'edit';
  }

  if (tokens.modifyToken && MODIFY_TOKEN_PATTERN.test(tokens.modifyToken)) {
    return 'modify';
  }

  return null;
}

/**
 * 指定されたドキュメントの特権管理権限(`editToken`)を保持しているか判定する。
 *
 * @param id - ドキュメントID(`slug`)。
 * @returns 特権管理権限を保持していれば `true`、それ以外は `false`。
 */
export function hasEditPermission(id: string): boolean {
  return getDocumentTokenRole(id) === 'edit';
}

/**
 * 指定されたドキュメントの本文更新権限(`editToken` または `modifyToken`)を保持しているか判定する。
 *
 * @param id - ドキュメントID(`slug`)。
 * @returns 本文更新権限を保持していれば `true`、それ以外は `false`。
 */
export function hasModifyPermission(id: string): boolean {
  return getDocumentTokenRole(id) !== null;
}

/**
 * 有効なドキュメントID一覧に含まれない古いトークンを一括パージする。
 *
 * @param validIds - 保持を許可する有効なドキュメントIDの一覧。
 */
export function clearStaleTokens(validIds: string[]): void {
  const map = readTokenMap();
  const validSet = new Set(validIds);
  let changed = false;

  for (const key of Object.keys(map)) {
    if (!validSet.has(key)) {
      delete map[key];
      changed = true;
    }
  }

  if (changed) {
    writeTokenMap(map);
  }
}

/**
 * URLハッシュから管理トークン(`edit_token` または `modify_token`)を抽出し、
 * 正当な形式であれば `localStorage` へ取り込んだ上でアドレスバーからハッシュを消去する。
 *
 * 画面共有やURLコピーによるトークン漏洩を防止するセキュリティ自己サニタイズ処理。
 *
 * @param documentId - 対象のドキュメントID(`slug`)。
 * @returns インポートに成功したトークンオブジェクト。検出されなかった場合は `null`。
 */
export function consumeTokenFromUrlHash(
  documentId: string,
): { editToken?: string; modifyToken?: string } | null {
  if (
    typeof window === 'undefined' ||
    !documentId ||
    !SLUG_PATTERN.test(documentId)
  ) {
    return null;
  }

  const hash = window.location.hash;
  if (!hash || hash.length <= 1) {
    return null;
  }

  const rawParams = hash.startsWith('#') ? hash.slice(1) : hash;
  const searchParams = new URLSearchParams(rawParams);

  const editTokenCandidate =
    searchParams.get('edit_token') ?? searchParams.get('editToken');
  const modifyTokenCandidate =
    searchParams.get('modify_token') ?? searchParams.get('modifyToken');

  const editToken =
    editTokenCandidate && EDIT_TOKEN_PATTERN.test(editTokenCandidate)
      ? editTokenCandidate
      : undefined;
  const modifyToken =
    modifyTokenCandidate && MODIFY_TOKEN_PATTERN.test(modifyTokenCandidate)
      ? modifyTokenCandidate
      : undefined;

  if (!editToken && !modifyToken) {
    return null;
  }

  saveDocumentTokens(documentId, { editToken, modifyToken });

  try {
    const cleanUrl = window.location.pathname + window.location.search;
    window.history.replaceState(null, '', cleanUrl);
  } catch (error) {
    console.warn('URLハッシュのサニタイズ消去に失敗。', error);
  }

  return { editToken, modifyToken };
}

/**
 * パスコード照合によって取得した閲覧用署名トークン(`JWT`)を保存する。
 *
 * Cloudflare Pages と Workers の別オリジン構成でも SSR 側のリクエストに `Cookie` が中継されるよう、
 * フロントエンド(Pages)側の `document.cookie` に設定し、同時に `localStorage` にも退避する。
 *
 * @param documentId - 対象のドキュメントID(`slug`)。
 * @param token - パスコード照合APIから発行された閲覧用 `JWT`。
 */
export function savePasscodeViewToken(documentId: string, token: string): void {
  if (
    typeof window === 'undefined' ||
    !documentId ||
    !SLUG_PATTERN.test(documentId) ||
    !token
  ) {
    return;
  }

  const cookieName = `${PASSCODE_AUTH_COOKIE_PREFIX}${documentId}`;
  const isSecure = window.location.protocol === 'https:';
  const cookieParts = [
    `${cookieName}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${VIEW_TOKEN_EXPIRATION_SECONDS}`,
    'SameSite=Lax',
  ];
  if (isSecure) {
    cookieParts.push('Secure');
  }
  document.cookie = cookieParts.join('; ');

  const map = readTokenMap();
  const existing = map[documentId];

  map[documentId] = {
    editToken: existing?.editToken,
    modifyToken: existing?.modifyToken,
    viewToken: token,
    savedAt: new Date().toISOString(),
  };

  writeTokenMap(map);
}

/**
 * 指定されたドキュメントの閲覧用署名トークン(`JWT`)を取得する。
 *
 * `document.cookie` からの取得を優先し、未検出時は `localStorage` の退避値を取得する。
 *
 * @param documentId - ドキュメントID(`slug`)。
 * @returns 保持されている閲覧トークン文字列。未保持時は `null`。
 */
export function getPasscodeViewToken(documentId: string): string | null {
  if (
    typeof window === 'undefined' ||
    !documentId ||
    !SLUG_PATTERN.test(documentId)
  ) {
    return null;
  }

  const cookiePrefix = `${PASSCODE_AUTH_COOKIE_PREFIX}${documentId}=`;
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const trimmed = cookie.trim();
    if (trimmed.startsWith(cookiePrefix)) {
      const rawValue = trimmed.slice(cookiePrefix.length);
      try {
        return decodeURIComponent(rawValue);
      } catch {
        return rawValue;
      }
    }
  }

  const map = readTokenMap();
  return map[documentId]?.viewToken ?? null;
}

/**
 * 指定されたドキュメントの閲覧用署名トークンを `Cookie` および `localStorage` から削除する。
 *
 * @param documentId - 対象のドキュメントID(`slug`)。
 */
export function removePasscodeViewToken(documentId: string): void {
  if (
    typeof window === 'undefined' ||
    !documentId ||
    !SLUG_PATTERN.test(documentId)
  ) {
    return;
  }

  const cookieName = `${PASSCODE_AUTH_COOKIE_PREFIX}${documentId}`;
  document.cookie = `${cookieName}=; Path=/; Max-Age=0; SameSite=Lax`;

  const map = readTokenMap();
  if (map[documentId]) {
    delete map[documentId].viewToken;
    writeTokenMap(map);
  }
}
