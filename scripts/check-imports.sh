#!/usr/bin/env bash
# Chokepoint import lint. Ensures raw providers and decrypt services are not
# imported outside their owner modules. Fail-closed: exit non-zero on any hit.
set -euo pipefail

bad=0
check() {
  local pattern="$1" allowed="$2" label="$3"
  # shellcheck disable=SC2086
  hits=$(grep -rn -E "$pattern" apps/api/src 2>/dev/null | grep -v -E "$allowed" || true)
  if [[ -n "$hits" ]]; then
    echo "=== $label (FORBIDDEN IMPORT LOCATIONS) ==="
    echo "$hits"
    bad=1
  fi
}

# Raw SDKs: only providers/* may import.
check "from ['\"](twilio|@sendgrid/mail)['\"]" "apps/api/src/modules/providers/" "raw provider SDKs"

# Raw provider classes: only providers/* + provider-adapter may import.
check "from .*/(email|sms|voice)\.provider['\"]" \
      "apps/api/src/modules/providers/" \
      "raw provider classes"

# VaultDecryptor: only release-executor + release-worker-crypto + workers/release.worker.
check "from .*crypto/vault-decryptor" \
      "apps/api/src/(modules/releases|modules/crypto|workers/release\.worker)" \
      "VaultDecryptor"

# KmsService: only crypto module + envelope + vault-decryptor.
check "from .*crypto/kms\.service" \
      "apps/api/src/modules/crypto/" \
      "KmsService"

# Direct AuditEvent inserts: only AuditService may do this.
check "prisma\.auditEvent\.(create|createMany)" \
      "apps/api/src/modules/audit/audit\.service" \
      "AuditEvent direct insert"

exit "$bad"
