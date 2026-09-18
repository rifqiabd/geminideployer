CREATE TABLE IF NOT EXISTS app_records (
    id TEXT PRIMARY KEY,
    app_slug TEXT NOT NULL,
    user_id TEXT,
    payload_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_records_slug ON app_records(app_slug);