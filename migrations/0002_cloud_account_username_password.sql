ALTER TABLE cloud_accounts ADD COLUMN username TEXT;
ALTER TABLE cloud_accounts ADD COLUMN password_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_accounts_username ON cloud_accounts(username);
