-- CreateEnum
CREATE TYPE "ScenarioState" AS ENUM ('draft', 'armed', 'incident_pending', 'escalation_in_progress', 'grace_period', 'release_in_progress', 'released', 'aborted', 'expired');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'locked', 'closed');

-- CreateEnum
CREATE TYPE "RecipientKind" AS ENUM ('email', 'sms', 'secure_link', 'social_handle');

-- CreateEnum
CREATE TYPE "AccessMethod" AS ENUM ('direct', 'secure_link');

-- CreateEnum
CREATE TYPE "BundleVisibility" AS ENUM ('private', 'public');

-- CreateEnum
CREATE TYPE "ReleaseStage" AS ENUM ('on_release', 'on_incident_open');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('email', 'sms', 'social');

-- CreateEnum
CREATE TYPE "CheckinResult" AS ENUM ('ok', 'missed');

-- CreateEnum
CREATE TYPE "CheckinMethod" AS ENUM ('app', 'sms_reply', 'call_confirm');

-- CreateEnum
CREATE TYPE "EscalationStatus" AS ENUM ('queued', 'sent', 'acked', 'failed');

-- CreateEnum
CREATE TYPE "ReleaseActionState" AS ENUM ('pending', 'sending', 'executed', 'failed_temporary', 'failed_permanent', 'aborted', 'suppressed', 'sent_after_abort');

-- CreateEnum
CREATE TYPE "ReleaseState" AS ENUM ('pending', 'executing', 'completed', 'partially_failed', 'aborted');

-- CreateEnum
CREATE TYPE "AuditActor" AS ENUM ('user', 'system', 'contact', 'release_worker', 'admin');

-- CreateEnum
CREATE TYPE "SessionRevokeReason" AS ENUM ('logout', 'rotated', 'family_compromise', 'admin_revoke', 'expired');

-- CreateEnum
CREATE TYPE "ContactGrantKind" AS ENUM ('bundle_vault_unwrap', 'bundle_alert_only');

-- CreateEnum
CREATE TYPE "KdfMigrationState" AS ENUM ('idle', 'in_progress', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "SafetyModeKind" AS ENUM ('normal', 'degraded', 'release_restricted', 'audit_compromised', 'emergency_freeze');

-- CreateEnum
CREATE TYPE "CircuitState" AS ENUM ('closed', 'open', 'half_open');

-- CreateEnum
CREATE TYPE "AdminRequestKind" AS ENUM ('enter_mode', 'exit_mode', 'pause_provider', 'resume_provider', 'pause_queue', 'resume_queue', 'reduce_concurrency', 'drain_releases', 'force_unlock_release');

-- CreateEnum
CREATE TYPE "AdminRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'expired', 'executed');

-- CreateTable
CREATE TABLE "SafetyMode" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "mode" "SafetyModeKind" NOT NULL DEFAULT 'normal',
    "isolatedProviders" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reason" TEXT,
    "enteredBy" TEXT,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "autoEntered" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "SafetyMode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyModeTransition" (
    "id" TEXT NOT NULL,
    "from" "SafetyModeKind" NOT NULL,
    "to" "SafetyModeKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "autoEntered" BOOLEAN NOT NULL DEFAULT false,
    "policyVersion" TEXT NOT NULL,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetyModeTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderCircuitBreaker" (
    "provider" TEXT NOT NULL,
    "state" "CircuitState" NOT NULL DEFAULT 'closed',
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "ambiguousCount" INTEGER NOT NULL DEFAULT 0,
    "lastFailureAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "nextProbeAt" TIMESTAMP(3),
    "consecutiveProbes" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,

    CONSTRAINT "ProviderCircuitBreaker_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "AdminRequest" (
    "id" TEXT NOT NULL,
    "kind" "AdminRequestKind" NOT NULL,
    "params" JSONB NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "AdminRequestStatus" NOT NULL DEFAULT 'pending',
    "reason" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "approvalNonce" TEXT NOT NULL,

    CONSTRAINT "AdminRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "phoneE164" TEXT,
    "phoneVerifiedAt" TIMESTAMP(3),
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "kdfVersion" INTEGER NOT NULL DEFAULT 1,
    "kdfMigrationState" "KdfMigrationState" NOT NULL DEFAULT 'idle',
    "kdfMigrationFrom" INTEGER,
    "kdfMigrationTo" INTEGER,
    "kdfMigrationStartedAt" TIMESTAMP(3),
    "kdfMigrationUpdatedAt" TIMESTAMP(3),
    "publicKey" TEXT,
    "recoveryHash" TEXT,
    "cooldownUntil" TIMESTAMP(3),
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "accountCreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "parentId" TEXT,
    "deviceId" TEXT,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" "SessionRevokeReason",

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "devicePublicKey" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "pushToken" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustedContact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phoneE164" TEXT,
    "relationship" TEXT,
    "canRequestPause" BOOLEAN NOT NULL DEFAULT true,
    "pauseBudgetSeconds" INTEGER NOT NULL DEFAULT 86400,
    "pauseUsedSeconds" INTEGER NOT NULL DEFAULT 0,
    "maxSinglePauseSec" INTEGER NOT NULL DEFAULT 43200,
    "pauseRequestCount" INTEGER NOT NULL DEFAULT 0,
    "pauseCooldownUntil" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustedContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustedContactGrant" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "kind" "ContactGrantKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustedContactGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationPolicy" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stepsJson" JSONB NOT NULL,
    "defaults" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EscalationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scenario" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "state" "ScenarioState" NOT NULL DEFAULT 'draft',
    "activationAt" TIMESTAMP(3),
    "expectedDurationSeconds" INTEGER,
    "mustRenewBy" TIMESTAMP(3),
    "autoExpireAt" TIMESTAMP(3),
    "checkinIntervalSeconds" INTEGER NOT NULL,
    "gracePeriodSeconds" INTEGER NOT NULL,
    "escalationPolicyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "armedAt" TIMESTAMP(3),
    "abortedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "incidentOpenedAt" TIMESTAMP(3),

    CONSTRAINT "Scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseBundle" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "releaseStage" "ReleaseStage" NOT NULL DEFAULT 'on_release',
    "visibility" "BundleVisibility" NOT NULL DEFAULT 'private',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseBundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BundleRecipient" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "recipientKind" "RecipientKind" NOT NULL,
    "address" TEXT NOT NULL,
    "displayName" TEXT,
    "accessMethod" "AccessMethod" NOT NULL DEFAULT 'direct',
    "requireRecipientPin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BundleRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BundleMessage" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "recipientId" TEXT,
    "messageCiphertext" BYTEA NOT NULL,
    "messageNonce" BYTEA NOT NULL,
    "messageDekWrapped" BYTEA NOT NULL,
    "channel" "Channel" NOT NULL,
    "socialProviderId" TEXT,
    "subject" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BundleMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BundleAttachment" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "blobRef" TEXT NOT NULL,
    "ciphertextHash" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "clientMimeType" TEXT,
    "displayFilename" TEXT NOT NULL DEFAULT 'attachment.bin',
    "encryptionMode" TEXT NOT NULL,
    "aadVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BundleAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttachmentAccessToken" (
    "id" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "releaseActionId" TEXT,
    "bundleId" TEXT NOT NULL,
    "tokenIndex" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "kdfSalt" BYTEA NOT NULL,
    "sealedDek" BYTEA NOT NULL,
    "sealedDekNonce" BYTEA NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 3,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "firstUsedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttachmentAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivateVaultItem" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "ciphertextBlobRef" TEXT NOT NULL,
    "wrappedDek" BYTEA NOT NULL,
    "clientKeyId" TEXT NOT NULL,
    "nonce" BYTEA NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivateVaultItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipientVaultUnwrap" (
    "id" TEXT NOT NULL,
    "vaultItemId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "sealingMode" TEXT NOT NULL,
    "sealedDek" BYTEA NOT NULL,
    "sealingSalt" BYTEA,
    "sealingParams" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecipientVaultUnwrap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipientAccessToken" (
    "id" TEXT NOT NULL,
    "vaultItemId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "tokenIndex" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "accessCodeHash" TEXT,
    "maxUses" INTEGER NOT NULL DEFAULT 3,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "firstUsedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecipientAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Checkin" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "performedAt" TIMESTAMP(3),
    "method" "CheckinMethod",
    "result" "CheckinResult" NOT NULL DEFAULT 'missed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Checkin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationAttempt" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "status" "EscalationStatus" NOT NULL DEFAULT 'queued',
    "externalRef" TEXT,
    "attemptedAt" TIMESTAMP(3),
    "ackedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EscalationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Release" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "state" "ReleaseState" NOT NULL DEFAULT 'pending',
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "triggerReason" TEXT NOT NULL,
    "canceledAt" TIMESTAMP(3),
    "canceledBy" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseAction" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "messageId" TEXT,
    "recipientId" TEXT NOT NULL,
    "state" "ReleaseActionState" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "provider" TEXT,
    "providerMessageId" TEXT,
    "providerStatus" TEXT,
    "providerStatusAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundDispatch" (
    "idempotencyKey" TEXT NOT NULL,
    "releaseActionId" TEXT,
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "OutboundDispatch_pkey" PRIMARY KEY ("idempotencyKey")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scenarioId" TEXT,
    "chainScope" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "actor" "AuditActor" NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadRedacted" JSONB NOT NULL,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key","bucketStart")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "queueName" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditExport" (
    "chainScope" TEXT NOT NULL,
    "exportedUpToSeq" INTEGER NOT NULL DEFAULT 0,
    "lastExportedAt" TIMESTAMP(3),
    "lastSinkObject" TEXT,
    "lastSinkHash" TEXT,

    CONSTRAINT "AuditExport_pkey" PRIMARY KEY ("chainScope")
);

-- CreateTable
CREATE TABLE "AbortCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbortCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SafetyModeTransition_occurredAt_idx" ON "SafetyModeTransition"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminRequest_approvalNonce_key" ON "AdminRequest"("approvalNonce");

-- CreateIndex
CREATE INDEX "AdminRequest_status_expiresAt_idx" ON "AdminRequest"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneE164_key" ON "User"("phoneE164");

-- CreateIndex
CREATE UNIQUE INDEX "Session_refreshTokenHash_key" ON "Session"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_familyId_idx" ON "Session"("userId", "familyId");

-- CreateIndex
CREATE INDEX "Session_familyId_idx" ON "Session"("familyId");

-- CreateIndex
CREATE INDEX "Device_userId_idx" ON "Device"("userId");

-- CreateIndex
CREATE INDEX "TrustedContact_userId_idx" ON "TrustedContact"("userId");

-- CreateIndex
CREATE INDEX "TrustedContactGrant_bundleId_idx" ON "TrustedContactGrant"("bundleId");

-- CreateIndex
CREATE UNIQUE INDEX "TrustedContactGrant_contactId_bundleId_kind_key" ON "TrustedContactGrant"("contactId", "bundleId", "kind");

-- CreateIndex
CREATE INDEX "EscalationPolicy_userId_idx" ON "EscalationPolicy"("userId");

-- CreateIndex
CREATE INDEX "Scenario_userId_state_idx" ON "Scenario"("userId", "state");

-- CreateIndex
CREATE INDEX "ReleaseBundle_scenarioId_idx" ON "ReleaseBundle"("scenarioId");

-- CreateIndex
CREATE INDEX "BundleRecipient_bundleId_idx" ON "BundleRecipient"("bundleId");

-- CreateIndex
CREATE INDEX "BundleMessage_bundleId_idx" ON "BundleMessage"("bundleId");

-- CreateIndex
CREATE INDEX "BundleAttachment_bundleId_idx" ON "BundleAttachment"("bundleId");

-- CreateIndex
CREATE UNIQUE INDEX "AttachmentAccessToken_tokenIndex_key" ON "AttachmentAccessToken"("tokenIndex");

-- CreateIndex
CREATE INDEX "AttachmentAccessToken_attachmentId_idx" ON "AttachmentAccessToken"("attachmentId");

-- CreateIndex
CREATE INDEX "AttachmentAccessToken_recipientId_idx" ON "AttachmentAccessToken"("recipientId");

-- CreateIndex
CREATE INDEX "AttachmentAccessToken_releaseId_idx" ON "AttachmentAccessToken"("releaseId");

-- CreateIndex
CREATE INDEX "PrivateVaultItem_bundleId_idx" ON "PrivateVaultItem"("bundleId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipientVaultUnwrap_vaultItemId_recipientId_key" ON "RecipientVaultUnwrap"("vaultItemId", "recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipientAccessToken_tokenIndex_key" ON "RecipientAccessToken"("tokenIndex");

-- CreateIndex
CREATE INDEX "RecipientAccessToken_vaultItemId_idx" ON "RecipientAccessToken"("vaultItemId");

-- CreateIndex
CREATE INDEX "RecipientAccessToken_recipientId_idx" ON "RecipientAccessToken"("recipientId");

-- CreateIndex
CREATE INDEX "Checkin_scenarioId_idx" ON "Checkin"("scenarioId");

-- CreateIndex
CREATE UNIQUE INDEX "Checkin_scenarioId_dueAt_key" ON "Checkin"("scenarioId", "dueAt");

-- CreateIndex
CREATE INDEX "EscalationAttempt_scenarioId_idx" ON "EscalationAttempt"("scenarioId");

-- CreateIndex
CREATE INDEX "Release_scenarioId_idx" ON "Release"("scenarioId");

-- CreateIndex
CREATE INDEX "ReleaseAction_releaseId_idx" ON "ReleaseAction"("releaseId");

-- CreateIndex
CREATE INDEX "ReleaseAction_state_idx" ON "ReleaseAction"("state");

-- CreateIndex
CREATE INDEX "ReleaseAction_providerMessageId_idx" ON "ReleaseAction"("providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseAction_releaseId_bundleId_recipientId_messageId_key" ON "ReleaseAction"("releaseId", "bundleId", "recipientId", "messageId");

-- CreateIndex
CREATE INDEX "OutboundDispatch_releaseActionId_idx" ON "OutboundDispatch"("releaseActionId");

-- CreateIndex
CREATE INDEX "AuditEvent_userId_occurredAt_idx" ON "AuditEvent"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_scenarioId_occurredAt_idx" ON "AuditEvent"("scenarioId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_chainScope_seq_key" ON "AuditEvent"("chainScope", "seq");

-- CreateIndex
CREATE INDEX "OutboxEvent_availableAt_lockedUntil_idx" ON "OutboxEvent"("availableAt", "lockedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_queueName_jobId_key" ON "OutboxEvent"("queueName", "jobId");

-- CreateIndex
CREATE INDEX "AbortCode_userId_idx" ON "AbortCode"("userId");

-- CreateIndex
CREATE INDEX "AbortCode_scenarioId_idx" ON "AbortCode"("scenarioId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedContact" ADD CONSTRAINT "TrustedContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedContactGrant" ADD CONSTRAINT "TrustedContactGrant_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "TrustedContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedContactGrant" ADD CONSTRAINT "TrustedContactGrant_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "ReleaseBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationPolicy" ADD CONSTRAINT "EscalationPolicy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scenario" ADD CONSTRAINT "Scenario_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scenario" ADD CONSTRAINT "Scenario_escalationPolicyId_fkey" FOREIGN KEY ("escalationPolicyId") REFERENCES "EscalationPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseBundle" ADD CONSTRAINT "ReleaseBundle_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleRecipient" ADD CONSTRAINT "BundleRecipient_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "ReleaseBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleMessage" ADD CONSTRAINT "BundleMessage_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "ReleaseBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleMessage" ADD CONSTRAINT "BundleMessage_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "BundleRecipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleAttachment" ADD CONSTRAINT "BundleAttachment_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "ReleaseBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttachmentAccessToken" ADD CONSTRAINT "AttachmentAccessToken_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "BundleAttachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttachmentAccessToken" ADD CONSTRAINT "AttachmentAccessToken_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "BundleRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttachmentAccessToken" ADD CONSTRAINT "AttachmentAccessToken_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateVaultItem" ADD CONSTRAINT "PrivateVaultItem_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "ReleaseBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipientVaultUnwrap" ADD CONSTRAINT "RecipientVaultUnwrap_vaultItemId_fkey" FOREIGN KEY ("vaultItemId") REFERENCES "PrivateVaultItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipientVaultUnwrap" ADD CONSTRAINT "RecipientVaultUnwrap_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "BundleRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipientAccessToken" ADD CONSTRAINT "RecipientAccessToken_vaultItemId_fkey" FOREIGN KEY ("vaultItemId") REFERENCES "PrivateVaultItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipientAccessToken" ADD CONSTRAINT "RecipientAccessToken_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "BundleRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkin" ADD CONSTRAINT "Checkin_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationAttempt" ADD CONSTRAINT "EscalationAttempt_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseAction" ADD CONSTRAINT "ReleaseAction_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbortCode" ADD CONSTRAINT "AbortCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbortCode" ADD CONSTRAINT "AbortCode_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

