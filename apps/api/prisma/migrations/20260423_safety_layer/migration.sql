-- =========================================================================
-- Self-protection layer. Single-row SafetyMode guarantee + seed.
-- =========================================================================

-- Exactly one SafetyMode row with id='global' may exist.
ALTER TABLE "SafetyMode"
  DROP CONSTRAINT IF EXISTS safety_mode_singleton_ck;
ALTER TABLE "SafetyMode"
  ADD CONSTRAINT safety_mode_singleton_ck CHECK (id = 'global');

INSERT INTO "SafetyMode" (id, mode, "enteredAt", "autoEntered")
VALUES ('global', 'normal', NOW(), false)
ON CONFLICT (id) DO NOTHING;

-- Forbid audit_compromised / emergency_freeze from being exited without
-- going through the application layer. The app uses a stored procedure-ish
-- pattern: UPDATE WHERE current_mode=X and bumping to Y; the trigger below
-- just keeps operators from directly sneaking out by a raw UPDATE that
-- omits the approval trail.
CREATE OR REPLACE FUNCTION guard_safety_mode_exit() RETURNS trigger AS $$
BEGIN
  IF OLD.mode IN ('audit_compromised', 'emergency_freeze')
     AND NEW.mode = 'normal'
     AND NEW."autoEntered" = true THEN
    RAISE EXCEPTION 'safety_mode: cannot auto-exit % (requires dual-control)',
      OLD.mode;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS safety_mode_exit_guard ON "SafetyMode";
CREATE TRIGGER safety_mode_exit_guard
  BEFORE UPDATE ON "SafetyMode"
  FOR EACH ROW EXECUTE FUNCTION guard_safety_mode_exit();

-- AdminRequest: executed requests cannot be mutated.
CREATE OR REPLACE FUNCTION guard_admin_request_terminal() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('executed','rejected','expired') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'admin_request %: terminal status % cannot change',
      OLD.id, OLD.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS admin_request_terminal_guard ON "AdminRequest";
CREATE TRIGGER admin_request_terminal_guard
  BEFORE UPDATE ON "AdminRequest"
  FOR EACH ROW EXECUTE FUNCTION guard_admin_request_terminal();
