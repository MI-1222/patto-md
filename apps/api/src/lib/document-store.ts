import {
  type DocumentVisibility,
  type ExpirationPreset,
  type OwnerProvider,
  generateCapabilityToken,
  hashToken,
} from '@patto-md/shared';
import { calculateExpiresAt } from './date.ts';
import { hashPasscode } from './passcode.ts';
import { generateSlug } from './slug.ts';

/** ドキュメント登録時の添付ファイル情報。 */
export interface CreateDocumentAttachmentItem {
  /** 添付ファイルID(UUID)。 */
  id: string;
  /** 元ファイル名。 */
  fileName: string;
  /** ファイルサイズ(バイト)。 */
  fileSize: number;
  /** MIMEタイプ。 */
  mimeType: string;
  /** R2オブジェクトキー。 */
  r2Key: string;
}

/** ドキュメント永続化の入力パラメータ。 */
export interface CreateDocumentInput {
  /** ドキュメントタイトル。 */
  title: string;
  /** 本文抜粋・要約(任意)。 */
  description?: string | null;
  /** R2上のMarkdown本文キー。 */
  contentR2Key: string;
  /** 有効期限プリセット。 */
  expiration: ExpirationPreset;
  /** 公開範囲(省略時は 'public')。 */
  visibility?: DocumentVisibility;
  /** 保護時のパスコード(平文、任意)。 */
  passcode?: string;
  /** オーナーユーザーID(任意)。 */
  ownerUserId?: string | null;
  /** オーナープロバイダ(任意)。 */
  ownerProvider?: OwnerProvider | null;
  /** 添付ファイル一覧(省略時は空配列)。 */
  attachments?: CreateDocumentAttachmentItem[];
  /** 作成日時(ISO 8601、省略時は現在日時)。 */
  createdAt?: string;
}

/** ドキュメント永続化の実行結果。 */
export interface CreateDocumentResult {
  /** 発行されたドキュメントID(Slug)。 */
  slug: string;
  /** 編集用ケイパビリティトークン(平文)。 */
  editToken: string;
  /** 更新用ケイパビリティトークン(平文)。 */
  modifyToken: string;
  /** 作成日時(ISO 8601文字列)。 */
  createdAt: string;
  /** 更新日時(ISO 8601文字列)。 */
  updatedAt: string;
  /** 有効期限日時(ISO 8601文字列、無期限時は null)。 */
  expiresAt: string | null;
}

/** Slug の衝突による採番失敗エラー。 */
export class SlugCollisionError extends Error {
  constructor(message = 'ドキュメント識別子の採番に失敗しました。') {
    super(message);
    this.name = 'SlugCollisionError';
  }
}

/** Slug 衝突時の最大リトライ回数。 */
export const MAX_SLUG_COLLISION_RETRIES = 3;

/**
 * ドキュメントおよび添付ファイルのメタデータを D1 へ永続化する。
 *
 * Slug の衝突検知とリトライ、ケイパビリティトークンの生成・ハッシュ化、
 * パスコードのハッシュ化、有効期限の算出をアトミックに実行する。
 *
 * @param db D1データベースインスタンス。
 * @param input ドキュメント永続化に必要な入力パラメータ。
 * @returns 永続化されたドキュメントのメタデータおよび平文トークン。
 * @throws {SlugCollisionError} Slug の衝突によりリトライ上限を超過した場合。
 */
export async function createDocument(
  db: D1Database,
  input: CreateDocumentInput,
): Promise<CreateDocumentResult> {
  const {
    title,
    description = null,
    contentR2Key,
    expiration,
    visibility = 'public',
    passcode,
    ownerUserId = null,
    ownerProvider = null,
    attachments = [],
    createdAt: inputCreatedAt,
  } = input;

  const createdAt = inputCreatedAt ?? new Date().toISOString();
  const updatedAt = createdAt;
  const expiresAt = calculateExpiresAt(expiration, new Date(createdAt));

  const editToken = generateCapabilityToken('edit');
  const modifyToken = generateCapabilityToken('modify');
  const [editTokenHash, modifyTokenHash] = await Promise.all([
    hashToken(editToken),
    hashToken(modifyToken),
  ]);

  let passcodeHash: string | null = null;
  if (visibility === 'protected' && passcode) {
    passcodeHash = await hashPasscode(passcode);
  }

  let committedSlug: string | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_SLUG_COLLISION_RETRIES; attempt++) {
    const candidateSlug = generateSlug();

    const documentStatement = db
      .prepare(
        `INSERT INTO documents (
        id,
        title,
        description,
        content_r2_key,
        status,
        expires_at,
        edit_token_hash,
        modify_token_hash,
        visibility,
        passcode_hash,
        owner_user_id,
        owner_provider,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, 'published', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        candidateSlug,
        title,
        description,
        contentR2Key,
        expiresAt,
        editTokenHash,
        modifyTokenHash,
        visibility,
        passcodeHash,
        ownerUserId,
        ownerProvider,
        createdAt,
        updatedAt,
      );

    const attachmentStatements = attachments.map((attachment) => {
      return db
        .prepare(
          `INSERT INTO attachments (
          id,
          document_id,
          file_name,
          file_size,
          mime_type,
          r2_key,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          attachment.id,
          candidateSlug,
          attachment.fileName,
          attachment.fileSize,
          attachment.mimeType,
          attachment.r2Key,
          createdAt,
        );
    });

    try {
      await db.batch([documentStatement, ...attachmentStatements]);
      committedSlug = candidateSlug;
      break;
    } catch (error) {
      lastError = error;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (
        errorMessage.includes('UNIQUE constraint failed') ||
        errorMessage.includes('PRIMARY KEY')
      ) {
        console.warn(
          `Slug衝突を検知しました(${candidateSlug})。再試行中(${attempt + 1}/${MAX_SLUG_COLLISION_RETRIES})...`,
        );
        continue;
      }

      throw error;
    }
  }

  if (!committedSlug) {
    console.error('Slug生成とD1コミットのリトライ上限超過:', lastError);
    throw new SlugCollisionError();
  }

  return {
    slug: committedSlug,
    editToken,
    modifyToken,
    createdAt,
    updatedAt,
    expiresAt,
  };
}
