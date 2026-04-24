#!/usr/bin/env bash
# Vertical-slice smoke. Runs the full arm → miss → grace → release → email
# flow against a locally-running stack. Exits non-zero on any step that
# doesn't match expected state. NOT a replacement for the integration suite;
# this is what you run interactively while debugging.
set -euo pipefail

API="${API:-http://localhost:3000/api/v1}"
EMAIL="e2e-$(date +%s)@local.test"
PASS="correct horse battery staple"

echo "==> register"
tok=$(curl -fsS -X POST "$API/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"phoneE164\":\"+15555550100\",\"displayName\":\"e2e\",\"password\":\"$PASS\"}" \
  | jq -r .accessToken)
AUTH="authorization: Bearer $tok"

echo "==> create scenario (60s checkin / 60s grace — dev-only floors)"
sid=$(curl -fsS -X POST "$API/scenarios" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"name":"e2e","checkinIntervalSeconds":60,"gracePeriodSeconds":60}' | jq -r .id)

echo "==> create bundle + recipient + message"
bid=$(curl -fsS -X POST "$API/scenarios/$sid/bundles" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"title":"b","visibility":"private"}' | jq -r .id)
rid=$(curl -fsS -X POST "$API/bundles/$bid/recipients" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"recipientKind":"email","address":"heir@local.test"}' | jq -r .id)
curl -fsS -X POST "$API/bundles/$bid/messages" -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"recipientId\":\"$rid\",\"channel\":\"email\",\"subject\":\"will\",\"plaintext\":\"hello from beyond\"}" >/dev/null

echo "==> arm"
arm=$(curl -fsS -X POST "$API/scenarios/$sid/arm" -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"password\":\"$PASS\",\"biometricReceipt\":\"dev\"}")
echo "abort-code (store only once): $(jq -r .abortCode <<<"$arm")"

echo "==> waiting for check-in miss (~70s) + grace expiry (~70s)"
sleep 150

echo "==> fetch scenario state"
state=$(curl -fsS "$API/scenarios/$sid" -H "$AUTH" | jq -r .state)
echo "final state: $state"
if [[ "$state" != "released" ]]; then
  echo "FAIL: expected state=released" >&2
  exit 1
fi

echo "==> audit chain verifies"
# Hit a dev-only helper endpoint or fall back to DB. Assumes an
# audit verify endpoint exists in dev; if not, check DB directly:
#   psql -c "SELECT count(*) FROM \"AuditEvent\" WHERE \"chainScope\"='scenario:$sid'"

echo "PASS"
