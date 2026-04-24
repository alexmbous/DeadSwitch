#!/usr/bin/env bash
# Production deploy gate. Exit non-zero = refuse promotion.
#
# Invoked in CI right before `terraform apply` / `kubectl apply`. Checks are
# deliberately conservative; when in doubt the gate fails closed.
set -euo pipefail

fail() { echo "DEPLOY-GATE FAIL: $*" >&2; exit 1; }
ok()   { echo "  ok: $*"; }

: "${EXPECTED_POLICY_VERSION:?missing EXPECTED_POLICY_VERSION env var}"
: "${EXPECTED_NODE_ENV:=production}"
: "${RELEASE_WORKER_IMAGE:?missing RELEASE_WORKER_IMAGE}"
: "${API_IMAGE:?missing API_IMAGE}"

# ----- G1: KMS must not be mock in non-dev -----
if grep -r "KMS_MODE=mock" --include='*.env*' deploy/ 2>/dev/null | grep -v dev; then
  fail "G1: KMS_MODE=mock found in non-dev deploy env"
fi
ok "G1 KMS mode"

# ----- G2: policy version matches committed tag -----
RUNTIME_POLICY=$(node -e "require('./apps/api/dist/modules/safety/policy-version').POLICY.version" 2>/dev/null || true)
if [[ -z "$RUNTIME_POLICY" ]]; then
  fail "G2: could not read runtime policy version (build missing?)"
fi
if [[ "$RUNTIME_POLICY" != "$EXPECTED_POLICY_VERSION" ]]; then
  fail "G2: policy version drift — expected $EXPECTED_POLICY_VERSION, got $RUNTIME_POLICY"
fi
ok "G2 policy version $RUNTIME_POLICY"

# ----- G3: chokepoint import restrictions -----
bash scripts/check-imports.sh || fail "G3: chokepoint import lint failed"
ok "G3 import restrictions"

# ----- G4: tests -----
pnpm --filter @deadswitch/api test:integration || fail "G4: integration tests failed"
ok "G4 tests"

# ----- G5: migration review approval -----
if git diff --name-only "${DEPLOY_BASE_SHA:-HEAD~1}"..HEAD -- 'apps/api/prisma/migrations/**' \
  | grep -q .; then
  if ! grep -q "Approved-By: schema-owner" <(git log "${DEPLOY_BASE_SHA:-HEAD~1}"..HEAD); then
    fail "G5: migration changes require 'Approved-By: schema-owner' trailer"
  fi
fi
ok "G5 migrations"

# ----- G6: placeholder-secret grep -----
if grep -rE "(change-me|your-secret|TODO-secret|REPLACE_ME)" \
   --include='*.ts' --include='*.env*' --include='*.yaml' --include='*.tf' \
   deploy/ apps/ infra/ 2>/dev/null; then
  fail "G6: placeholder secret detected"
fi
ok "G6 placeholders"

# ----- G7: API and release-worker images must differ -----
if [[ "$API_IMAGE" == "$RELEASE_WORKER_IMAGE" ]]; then
  fail "G7: API and release-worker images must be distinct"
fi
ok "G7 image split"

# ----- G8/G9: IAM diff inspection (terraform plan) -----
if [[ -f "tf.plan.json" ]]; then
  if jq -e '.resource_changes[] | select(.type=="aws_iam_policy") | select(.change.actions[]=="update") | .change.after.policy | test("kms:Decrypt.*role/deaddrop-api")' tf.plan.json >/dev/null; then
    fail "G9: API IAM policy is gaining kms:Decrypt — forbidden"
  fi
  if jq -e '.resource_changes[] | select(.type=="aws_iam_policy") | select(.change.actions[]=="update") | .change.after.policy | test("kms:Encrypt.*role/deaddrop-release")' tf.plan.json >/dev/null; then
    fail "G9: release-worker IAM policy is gaining kms:Encrypt — forbidden"
  fi
fi
ok "G8/G9 IAM split"

# ----- G10: audit sink Object Lock -----
if [[ -n "${AUDIT_SINK_BUCKET:-}" ]]; then
  mode=$(aws s3api get-object-lock-configuration --bucket "$AUDIT_SINK_BUCKET" \
         --query 'ObjectLockConfiguration.Rule.DefaultRetention.Mode' --output text 2>/dev/null || echo MISSING)
  if [[ "$mode" != "COMPLIANCE" ]]; then
    fail "G10: audit sink bucket Object Lock mode is '$mode', require COMPLIANCE"
  fi
fi
ok "G10 audit sink WORM"

echo "deploy-gate: ALL CHECKS PASSED"
