-- パーソナルアクセストークン(PAT)管理テーブルの作成。
CREATE TABLE IF NOT EXISTS user_api_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    scopes TEXT NOT NULL,
    expires_at DATETIME,
    last_used_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- トークンハッシュ照合用の UNIQUE インデックス。
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_api_tokens_hash ON user_api_tokens(token_hash);

-- ユーザー単位のトークン一覧取得用インデックス。
CREATE INDEX IF NOT EXISTS idx_user_api_tokens_user ON user_api_tokens(user_id);
