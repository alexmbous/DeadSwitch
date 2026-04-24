-- =========================================================================
-- Production DB role separation. Runs once, idempotent, after base schema
-- migrations. Expects the `deaddrop_migrator` role (schema owner) to run it.
-- =========================================================================

-- App role: read/write business tables, INSERT-only audit.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='deaddrop_app') THEN
    CREATE ROLE deaddrop_app LOGIN PASSWORD :'app_password';
  END IF;
END $$;

GRANT CONNECT ON DATABASE deaddrop TO deaddrop_app;
GRANT USAGE ON SCHEMA public TO deaddrop_app;

-- Broad DML on business tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "User", "Session", "Device", "TrustedContact", "TrustedContactGrant",
  "EscalationPolicy", "Scenario", "ReleaseBundle", "BundleRecipient",
  "BundleMessage", "BundleAttachment", "PrivateVaultItem",
  "RecipientVaultUnwrap", "RecipientAccessToken", "Checkin",
  "EscalationAttempt", "Release", "ReleaseAction", "OutboundDispatch",
  "OutboxEvent", "SafetyMode", "SafetyModeTransition",
  "ProviderCircuitBreaker", "AdminRequest", "RateLimit", "AbortCode"
TO deaddrop_app;

-- AuditEvent: INSERT + SELECT only. The row-level trigger blocks UPDATE/DELETE
-- generally, but we ALSO revoke the GRANT so even the trigger isn't the only
-- thing standing between a bug and rewritten history.
GRANT SELECT, INSERT ON "AuditEvent" TO deaddrop_app;
REVOKE UPDATE, DELETE ON "AuditEvent" FROM deaddrop_app;

-- AuditExport is written by the audit-export-worker, not the app.
REVOKE ALL ON "AuditExport" FROM deaddrop_app;
GRANT SELECT ON "AuditExport" TO deaddrop_app;  -- read-only visibility for dashboards

-- Release role: narrower still. Reuses the same tables but we express intent.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='deaddrop_release') THEN
    CREATE ROLE deaddrop_release LOGIN PASSWORD :'release_password';
  END IF;
END $$;
GRANT CONNECT ON DATABASE deaddrop TO deaddrop_release;
GRANT USAGE ON SCHEMA public TO deaddrop_release;

GRANT SELECT ON
  "Scenario", "Release", "ReleaseAction", "ReleaseBundle", "BundleRecipient",
  "BundleMessage", "BundleAttachment", "PrivateVaultItem",
  "RecipientVaultUnwrap", "User", "TrustedContact", "TrustedContactGrant",
  "ProviderCircuitBreaker", "SafetyMode"
TO deaddrop_release;

GRANT UPDATE ON "Release", "ReleaseAction", "Scenario",
                "OutboundDispatch", "ProviderCircuitBreaker",
                "SafetyMode"
TO deaddrop_release;

GRANT INSERT ON "ReleaseAction", "OutboundDispatch",
                "ProviderCircuitBreaker", "SafetyModeTransition",
                "AuditEvent", "OutboxEvent"
TO deaddrop_release;

-- AuditEvent: insert + select only; no UPDATE/DELETE even for release worker.
REVOKE UPDATE, DELETE ON "AuditEvent" FROM deaddrop_release;

-- Audit reader role for the export worker.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='deaddrop_audit_reader') THEN
    CREATE ROLE deaddrop_audit_reader LOGIN PASSWORD :'audit_password';
  END IF;
END $$;
GRANT CONNECT ON DATABASE deaddrop TO deaddrop_audit_reader;
GRANT USAGE ON SCHEMA public TO deaddrop_audit_reader;
GRANT SELECT ON "AuditEvent" TO deaddrop_audit_reader;
GRANT SELECT, INSERT, UPDATE ON "AuditExport" TO deaddrop_audit_reader;

-- Migrator role (used only during schema changes; creds rotated after).
-- Already owner of schema; no GRANT changes needed.

-- Default privileges so future tables inherit the same pattern.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM deaddrop_app, deaddrop_release, deaddrop_audit_reader;
