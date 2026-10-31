-- 外部キー制約の有効化。
PRAGMA foreign_keys = ON;

-- 特権操作（削除・URL変更・有効期限延長・所有権移譲）用トークンハッシュカラムの追加。
ALTER TABLE documents ADD COLUMN edit_token_hash TEXT;

-- 本文更新専用トークンハッシュカラムの追加。
ALTER TABLE documents ADD COLUMN modify_token_hash TEXT;

-- OAuth連携ユーザーIDカラムの追加。
ALTER TABLE documents ADD COLUMN owner_user_id TEXT;

-- OAuth認証プロバイダ種別カラムの追加。
ALTER TABLE documents ADD COLUMN owner_provider TEXT;

-- ドキュメント公開範囲カラムの追加（既存レコードはすべて public とみなす）。
ALTER TABLE documents ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';

-- パスコード保護時の照合用ハッシュカラムの追加。
ALTER TABLE documents ADD COLUMN passcode_hash TEXT;

-- スパム・規約違反対策用の通報管理テーブル。
CREATE TABLE IF NOT EXISTS abuse_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    reporter_ip_hash TEXT NOT NULL,
    reason TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 通報件数集計および自動キルスイッチ判定用インデックス。
CREATE INDEX IF NOT EXISTS idx_abuse_doc ON abuse_reports(document_id);

