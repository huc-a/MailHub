-- MailHub v2 NEW DATABASE baseline. UTC epoch milliseconds; not an upgrade script.
PRAGMA foreign_keys = ON;
CREATE TABLE users (
 id TEXT PRIMARY KEY, access_issuer TEXT NOT NULL, access_subject TEXT NOT NULL,
 created_at_ms INTEGER NOT NULL, UNIQUE(access_issuer,access_subject)
);
CREATE TABLE mailboxes (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 address TEXT NOT NULL COLLATE NOCASE UNIQUE,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired','deleting','deleted')),
 generation INTEGER NOT NULL DEFAULT 0, created_at_ms INTEGER NOT NULL,
 expires_at_ms INTEGER NOT NULL, deleted_at_ms INTEGER,
 UNIQUE(id,user_id), CHECK(expires_at_ms>created_at_ms)
);
CREATE TABLE provider_accounts (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 provider TEXT NOT NULL CHECK(provider IN ('gmail','outlook')),
 provider_subject TEXT NOT NULL, email_address TEXT NOT NULL,
 auth_status TEXT NOT NULL CHECK(auth_status IN ('authorizing','connected','reauth_required','disconnecting','disconnected','blocked')),
 encrypted_refresh_token TEXT, key_version TEXT, granted_scopes_json TEXT NOT NULL DEFAULT '[]',
 sync_status TEXT NOT NULL DEFAULT 'idle' CHECK(sync_status IN ('idle','queued','syncing','backoff','blocked')),
 committed_cursor TEXT, checkpoint_json TEXT, sync_generation INTEGER NOT NULL DEFAULT 0,
 sync_scope_json TEXT NOT NULL DEFAULT '{}', last_synced_at_ms INTEGER, next_sync_at_ms INTEGER,
 lease_token TEXT, lease_expires_at_ms INTEGER, created_at_ms INTEGER NOT NULL,
 UNIQUE(user_id,provider,provider_subject), UNIQUE(id,user_id)
);
CREATE TABLE emails (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 source TEXT NOT NULL CHECK(source IN ('temporary','gmail','outlook')),
 mailbox_id TEXT, provider_account_id TEXT, provider_message_id TEXT NOT NULL,
 message_id_header TEXT, from_address TEXT NOT NULL DEFAULT '',
 to_addresses_json TEXT NOT NULL DEFAULT '[]', subject TEXT NOT NULL DEFAULT '', snippet TEXT NOT NULL DEFAULT '',
 received_at_ms INTEGER NOT NULL, created_at_ms INTEGER NOT NULL,
 local_is_read INTEGER NOT NULL DEFAULT 0 CHECK(local_is_read IN (0,1)),
 remote_is_read INTEGER CHECK(remote_is_read IN (0,1)),
 otp_candidates_json TEXT NOT NULL DEFAULT '[]',
 ingest_status TEXT NOT NULL DEFAULT 'staged' CHECK(ingest_status IN ('staged','ready','failed','deleting')),
 ingest_lease_token TEXT, ingest_lease_expires_at_ms INTEGER,
 source_generation INTEGER NOT NULL DEFAULT 0, seen_sync_generation INTEGER,
 body_truncated INTEGER NOT NULL DEFAULT 0 CHECK(body_truncated IN (0,1)),
 FOREIGN KEY(mailbox_id,user_id) REFERENCES mailboxes(id,user_id),
 FOREIGN KEY(provider_account_id,user_id) REFERENCES provider_accounts(id,user_id),
 CHECK((source='temporary' AND mailbox_id IS NOT NULL AND provider_account_id IS NULL)
    OR (source IN ('gmail','outlook') AND mailbox_id IS NULL AND provider_account_id IS NOT NULL)),
 UNIQUE(id,user_id)
);
CREATE UNIQUE INDEX uq_temp_msg ON emails(mailbox_id,provider_message_id) WHERE mailbox_id IS NOT NULL;
CREATE UNIQUE INDEX uq_provider_msg ON emails(provider_account_id,provider_message_id) WHERE provider_account_id IS NOT NULL;
CREATE INDEX ix_email_user_time ON emails(user_id,received_at_ms DESC,id DESC);
CREATE INDEX ix_email_mailbox_time ON emails(mailbox_id,received_at_ms DESC,id DESC);
CREATE INDEX ix_email_provider_time ON emails(provider_account_id,received_at_ms DESC,id DESC);
CREATE TABLE mail_objects (
 id TEXT PRIMARY KEY, email_id TEXT NOT NULL REFERENCES emails(id),
 kind TEXT NOT NULL CHECK(kind IN ('text','html','attachment','raw')),
 object_key TEXT NOT NULL UNIQUE, size_bytes INTEGER NOT NULL DEFAULT 0 CHECK(size_bytes>=0),
 checksum_sha256 TEXT,
 status TEXT NOT NULL DEFAULT 'expected' CHECK(status IN ('expected','uploaded','deleting','deleted')),
 created_at_ms INTEGER NOT NULL
);
CREATE INDEX ix_objects_email ON mail_objects(email_id);
CREATE TABLE email_attachments (
 id TEXT PRIMARY KEY, email_id TEXT NOT NULL REFERENCES emails(id),
 object_id TEXT REFERENCES mail_objects(id), filename TEXT NOT NULL,
 content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
 size_bytes INTEGER NOT NULL CHECK(size_bytes>=0), skipped_reason TEXT,
 CHECK((object_id IS NOT NULL AND skipped_reason IS NULL) OR (object_id IS NULL AND skipped_reason IS NOT NULL))
);
CREATE INDEX ix_attachments_email ON email_attachments(email_id);
CREATE TABLE jobs (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL CHECK(kind IN ('sync','cleanup_mailbox','cleanup_account','cleanup_email','revoke','reconcile')),
 target_id TEXT NOT NULL, dedup_key TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','retry_wait','succeeded','dead','cancelled')),
 payload_json TEXT NOT NULL DEFAULT '{}', checkpoint_json TEXT,
 attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 5,
 available_at_ms INTEGER NOT NULL, lease_token TEXT, lease_expires_at_ms INTEGER,
 error_code TEXT, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
);
CREATE UNIQUE INDEX uq_live_job ON jobs(dedup_key) WHERE status IN ('pending','running','retry_wait');
CREATE INDEX ix_jobs_due ON jobs(status,available_at_ms);
CREATE INDEX ix_jobs_user ON jobs(user_id,created_at_ms DESC);
CREATE TABLE oauth_states (
 state_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 provider TEXT NOT NULL, session_binding_hash TEXT NOT NULL, encrypted_code_verifier TEXT,
 key_version TEXT, expires_at_ms INTEGER NOT NULL, consumed_at_ms INTEGER
);
CREATE TABLE idempotency_keys (
 user_id TEXT NOT NULL REFERENCES users(id), request_key TEXT NOT NULL, route TEXT NOT NULL,
 request_hash TEXT NOT NULL, resource_id TEXT, response_status INTEGER,
 expires_at_ms INTEGER NOT NULL, PRIMARY KEY(user_id,route,request_key)
);
CREATE TABLE app_settings (
 user_id TEXT PRIMARY KEY REFERENCES users(id), settings_json TEXT NOT NULL DEFAULT '{}',
 version INTEGER NOT NULL DEFAULT 1, updated_at_ms INTEGER NOT NULL
);
-- App logic also enforces provider/source match, attachment ownership, JSON schema,
-- active parent checks, lease fencing, and write authorization.
-- Do not cascade object manifests away before successfully deleting their R2 objects.
