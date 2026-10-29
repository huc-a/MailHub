ALTER TABLE mailboxes ADD COLUMN provider TEXT NOT NULL DEFAULT 'native'
 CHECK(provider IN ('native','temp_mail_io'));
ALTER TABLE mailboxes ADD COLUMN provider_session_encrypted TEXT;
ALTER TABLE mailboxes ADD COLUMN provider_config_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE mailboxes ADD COLUMN last_provider_poll_at_ms INTEGER;

CREATE INDEX ix_mailboxes_provider_poll
 ON mailboxes(provider,status,expires_at_ms,last_provider_poll_at_ms);
