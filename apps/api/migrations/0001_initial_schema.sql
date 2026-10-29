-- 外部キー制約の有効化。
PRAGMA foreign_keys = ON;

-- ドキュメント本体テーブル。
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content_r2_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'published',
    expires_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 添付画像・ファイル管理テーブル。
CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- オンデマンド閲覧および有効期限判定用インデックス。
CREATE INDEX IF NOT EXISTS idx_documents_lookup ON documents(id, status, expires_at);

