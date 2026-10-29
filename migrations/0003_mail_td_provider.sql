-- Keep the constrained storage provider as the external-mail adapter bucket;
-- provider_service distinguishes individual remote services.
ALTER TABLE mailboxes ADD COLUMN provider_service TEXT;
UPDATE mailboxes SET provider_service='temp_mail_io' WHERE provider='temp_mail_io';
CREATE INDEX ix_mailboxes_provider_service ON mailboxes(provider_service,status,expires_at_ms,last_provider_poll_at_ms);
