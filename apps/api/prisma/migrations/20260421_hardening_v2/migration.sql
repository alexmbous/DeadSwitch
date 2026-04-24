-- =========================================================================
-- DeadSwitch hardening pass v2: database-level invariant enforcement.
-- Safe to re-run (all statements idempotent via IF NOT EXISTS guards).
-- =========================================================================

-- I6/I7/I8: state <-> timestamp coupling on scenarios.
ALTER TABLE "Scenario"
  DROP CONSTRAINT IF EXISTS scenario_state_timestamp_ck;
ALTER TABLE "Scenario"
  ADD CONSTRAINT scenario_state_timestamp_ck CHECK (
    -- armedAt must be set once the scenario has ever moved past draft
    (state = 'draft' OR "armedAt" IS NOT NULL)
    -- releasedAt iff state=released
    AND (
      (state = 'released' AND "releasedAt" IS NOT NULL)
      OR (state <> 'released' AND "releasedAt" IS NULL)
    )
    -- abortedAt iff state=aborted
    AND (
      (state = 'aborted' AND "abortedAt" IS NOT NULL)
      OR (state <> 'aborted' AND "abortedAt" IS NULL)
    )
  );

-- I3: at most one active release per scenario.
DROP INDEX IF EXISTS "release_active_per_scenario_unique";
CREATE UNIQUE INDEX "release_active_per_scenario_unique"
  ON "Release" ("scenarioId")
  WHERE state IN ('pending', 'executing');

-- I9: abort code cannot be reused. We can't enforce "used-at monotonic" via
-- CHECK across rows, but we can forbid rewinding usedAt to NULL.
CREATE OR REPLACE FUNCTION forbid_abort_code_unuse() RETURNS trigger AS $$
BEGIN
  IF OLD."usedAt" IS NOT NULL AND NEW."usedAt" IS NULL THEN
    RAISE EXCEPTION 'abort_code.usedAt cannot be cleared once set (row %)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS abort_code_unuse_guard ON "AbortCode";
CREATE TRIGGER abort_code_unuse_guard
  BEFORE UPDATE ON "AbortCode"
  FOR EACH ROW EXECUTE FUNCTION forbid_abort_code_unuse();

-- I1/I10: forbid transitions out of terminal scenario states.
CREATE OR REPLACE FUNCTION forbid_terminal_scenario_exit() RETURNS trigger AS $$
BEGIN
  IF OLD.state IN ('released', 'aborted', 'expired') AND NEW.state <> OLD.state THEN
    RAISE EXCEPTION 'scenario %: terminal state % cannot transition to %',
      OLD.id, OLD.state, NEW.state;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS scenario_terminal_guard ON "Scenario";
CREATE TRIGGER scenario_terminal_guard
  BEFORE UPDATE ON "Scenario"
  FOR EACH ROW EXECUTE FUNCTION forbid_terminal_scenario_exit();

-- I10: forbid release-action transitions out of terminal states.
CREATE OR REPLACE FUNCTION forbid_terminal_action_exit() RETURNS trigger AS $$
BEGIN
  IF OLD.state IN ('executed', 'failed_permanent', 'aborted', 'suppressed', 'sent_after_abort')
     AND NEW.state <> OLD.state THEN
    RAISE EXCEPTION 'release_action %: terminal state % cannot transition to %',
      OLD.id, OLD.state, NEW.state;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS release_action_terminal_guard ON "ReleaseAction";
CREATE TRIGGER release_action_terminal_guard
  BEFORE UPDATE ON "ReleaseAction"
  FOR EACH ROW EXECUTE FUNCTION forbid_terminal_action_exit();

-- Append-only audit log: forbid UPDATE and DELETE at the row level. In prod
-- this should ALSO be enforced by GRANTs (the app role has only INSERT and
-- SELECT). Trigger below is a belt-and-suspenders default.
CREATE OR REPLACE FUNCTION forbid_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent rows are append-only (op=%)', TG_OP;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_append_only_update ON "AuditEvent";
CREATE TRIGGER audit_append_only_update
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();
