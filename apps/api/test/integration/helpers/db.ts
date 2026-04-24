import type { PrismaService } from '../../../src/modules/prisma/prisma.service';

/**
 * Truncate every table except the seeded SafetyMode singleton. Order is
 * chosen to respect FKs; TRUNCATE ... CASCADE also does the job but leaves
 * a less obvious paper trail on failure.
 */
export async function truncateAll(prisma: PrismaService): Promise<void> {
  const tables = [
    '"AuditExport"',
    '"AuditEvent"',
    '"SafetyModeTransition"',
    '"ProviderCircuitBreaker"',
    '"AdminRequest"',
    '"OutboxEvent"',
    '"OutboundDispatch"',
    '"ReleaseAction"',
    '"Release"',
    '"EscalationAttempt"',
    '"Checkin"',
    '"RecipientAccessToken"',
    '"AttachmentAccessToken"',
    '"RecipientVaultUnwrap"',
    '"PrivateVaultItem"',
    '"BundleAttachment"',
    '"BundleMessage"',
    '"BundleRecipient"',
    '"ReleaseBundle"',
    '"TrustedContactGrant"',
    '"TrustedContact"',
    '"AbortCode"',
    '"EscalationPolicy"',
    '"Session"',
    '"Device"',
    '"Scenario"',
    '"User"',
    '"RateLimit"',
  ];
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
  // Reset safety mode to normal so each test starts clean.
  await prisma.$executeRawUnsafe(
    `UPDATE "SafetyMode" SET mode='normal', "isolatedProviders"='{}', reason=NULL,
       "enteredBy"=NULL, "enteredAt"=NOW(), "autoEntered"=false, notes=NULL
     WHERE id='global'`,
  );
}
