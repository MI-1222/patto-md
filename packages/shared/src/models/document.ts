/**
 * D1データベースのエンティティ型定義。
 */

/** ドキュメントの公開状態を表すステータス型。 */
export type DocumentStatus = 'published' | 'expired' | 'deleted' | 'suspended';

/** ドキュメントの公開範囲を表す型。 */
export type DocumentVisibility = 'public' | 'unlisted' | 'protected';

/** ドキュメント所有者のOAuth認証プロバイダ種別。 */
export type OwnerProvider = 'discord' | 'github';

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

  /** 特権操作(削除・設定変更・所有権移譲)用トークンのSHA-256ハッシュ値。 */
  edit_token_hash: string | null;

  /** 本文更新専用トークンのSHA-256ハッシュ値。 */
  modify_token_hash: string | null;

  /** OAuth連携後の所有者ユーザー識別子。 */
  owner_user_id: string | null;

  /** 所有者ユーザーの認証プロバイダ種別。 */
  owner_provider: OwnerProvider | null;

  /** ドキュメントの公開範囲。 */
  visibility: DocumentVisibility;

  /** パスコード保護時の照合用ハッシュ値。 */
  passcode_hash: string | null;

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

/** D1 abuse_reports テーブルのレコード型。 */
export interface AbuseReportRecord {
  /** 通報レコードの一意識別子(自動採番)。 */
  id: number;

  /** 通報対象ドキュメントのID。 */
  document_id: string;

  /** 通報者のIPアドレスハッシュ値。 */
  reporter_ip_hash: string;

  /** 通報理由テキスト(`null` の場合は未入力)。 */
  reason: string | null;

  /** レコード作成日時(ISO 8601文字列)。 */
  created_at: string;
}
