-- =========================================================================
-- Attachment release pipeline: per-recipient sealed DEKs, scoped tokens.
-- See AttachmentReleaseIssuer + AttachmentDownloadService for usage.
-- =========================================================================

-- New BundleAttachment columns. All rows pre-migration are tagged aadVersion=1
-- (legacy AAD format with no filename binding) and given a placeholder
-- displayFilename. New uploads use aadVersion=2.
ALTER TABLE "BundleAttachment"
  ADD COLUMN IF NOT EXISTS "displayFilename" TEXT NOT NULL DEFAULT 'attachment.bin',
  ADD COLUMN IF NOT EXISTS "clientMimeType"  TEXT,
  ADD COLUMN IF NOT EXISTS "aadVersion"      INTEGER NOT NULL DEFAULT 1;

-- New table: AttachmentAccessToken.
CREATE TABLE IF NOT EXISTS "AttachmentAccessToken" (
  "id"              TEXT PRIMARY KEY,
  "attachmentId"    TEXT NOT NULL,
  "recipientId"     TEXT NOT NULL,
  "releaseId"       TEXT NOT NULL,
  "releaseActionId" TEXT,
  "bundleId"        TEXT NOT NULL,
  "tokenIndex"      TEXT NOT NULL,
  "tokenHash"       TEXT NOT NULL,
  "kdfSalt"         BYTEA NOT NULL,
  "sealedDek"       BYTEA NOT NULL,
  "sealedDekNonce"  BYTEA NOT NULL,
  "maxUses"         INTEGER NOT NULL DEFAULT 3,
  "uses"            INTEGER NOT NULL DEFAULT 0,
  "expiresAt"       TIMESTAMP(3) NOT NULL,
  "firstUsedAt"     TIMESTAMP(3),
  "lastUsedAt"      TIMESTAMP(3),
  "revokedAt"       TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT NOW(),

  CONSTRAINT "AttachmentAccessToken_attachment_fk"
    FOREIGN KEY ("attachmentId") REFERENCES "BundleAttachment"("id") ON DELETE CASCADE,
  CONSTRAINT "AttachmentAccessToken_recipient_fk"
    FOREIGN KEY ("recipientId") REFERENCES "BundleRecipient"("id") ON DELETE CASCADE,
  CONSTRAINT "AttachmentAccessToken_release_fk"
    FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "AttachmentAccessToken_tokenIndex_key"
  ON "AttachmentAccessToken"("tokenIndex");
CREATE INDEX IF NOT EXISTS "AttachmentAccessToken_attachmentId_idx"
  ON "AttachmentAccessToken"("attachmentId");
CREATE INDEX IF NOT EXISTS "AttachmentAccessToken_recipientId_idx"
  ON "AttachmentAccessToken"("recipientId");
CREATE INDEX IF NOT EXISTS "AttachmentAccessToken_releaseId_idx"
  ON "AttachmentAccessToken"("releaseId");

-- Role grants. The API ('deaddrop_app') needs full DML to validate, mark
-- usage, revoke. The release worker ('deaddrop_release') only needs INSERT
-- (issue) + SELECT (read its own rows on retry-audit). Roles only exist if
-- the db_roles migration ran; gated by IF EXISTS.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='deaddrop_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "AttachmentAccessToken" TO deaddrop_app';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='deaddrop_release') THEN
    EXECUTE 'GRANT SELECT, INSERT ON "AttachmentAccessToken" TO deaddrop_release';
  END IF;
END $$;
