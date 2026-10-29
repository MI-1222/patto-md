/**
 * D1データベースのエンティティ型定義。
 */

/** ドキュメントの公開状態を表すステータス型。 */
export type DocumentStatus = 'published' | 'expired' | 'deleted' | 'suspended';

/** D1 documents テーブルのレコード型。 */
export interface DocumentRecord {
  /** 公開用Slug(NanoID 12文字)。 */
  id: string;

  /** ドキュメントのタイトル。 */
  title: string;

  /** 本文の要約・抜粋(`null` の場合は未設定)。 */
  description: string | null;

  /** R2上に保存されたMarkdown本文のオブジェクトキー。 */
  content_r2_key: string;

  /** ドキュメントの公開ステータス。 */
  status: DocumentStatus;

  /** 有効期限日時(ISO 8601文字列、nullの場合は無期限)。 */
  expires_at: string | null;

  /** レコード作成日時(ISO 8601文字列)。 */
  created_at: string;

  /** レコード最終更新日時(ISO 8601文字列)。 */
  updated_at: string;
}

/** D1 attachments テーブルのレコード型。 */
export interface AttachmentRecord {
  /** 添付ファイルの一意識別子(UUID)。 */
  id: string;

  /** 所属するドキュメントのID。 */
  document_id: string;

  /** アップロード元のファイル名。 */
  file_name: string;

  /** ファイルサイズ(バイト単位)。 */
  file_size: number;

  /** ファイルのMIMEタイプ。 */
  mime_type: string;

  /** R2上に保存された添付ファイルのオブジェクトキー。 */
  r2_key: string;

  /** レコード作成日時(ISO 8601文字列)。 */
  created_at: string;
}
