/** D1データベースのパーソナルアクセストークン(PAT)エンティティ型定義。 */

/** D1 `user_api_tokens` テーブルのレコード型。 */
export interface UserApiTokenRecord {
  /** トークンレコードの一意識別子(UUID)。 */
  id: string;

  /** トークン所有者の不変ユーザー識別子(`${provider}:${providerUserId}`)。 */
  user_id: string;

  /** トークンの識別表示名(例: "Cursor on MacBook")。 */
  name: string;

  /** トークン平文の SHA-256 ハッシュ値(小文字の Hex 64文字)。 */
  token_hash: string;

  /** 付与された認可スコープの JSON 配列文字列(例: `["documents:read","documents:write"]`)。 */
  scopes: string;

  /** 有効期限日時(ISO 8601 形式の文字列。無期限の場合は `null`)。 */
  expires_at: string | null;

  /** 最後にこの PAT で API アクセスを認可した日時(ISO 8601 形式の文字列。未利用時は `null`)。 */
  last_used_at: string | null;

  /** レコード作成日時(ISO 8601 形式の文字列)。 */
  created_at: string;
}
