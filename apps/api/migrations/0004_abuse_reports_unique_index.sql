-- 同一ドキュメントに対する同一IPハッシュからの重複通報をDB制約レベルで排除する複合ユニークインデックス。
CREATE UNIQUE INDEX IF NOT EXISTS uq_abuse_doc_reporter ON abuse_reports(document_id, reporter_ip_hash);
