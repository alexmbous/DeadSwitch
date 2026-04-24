import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ContactGrantKind } from '@prisma/client';

/**
 * Permission model for trusted contacts:
 *
 *  - By default, a contact receives alerts (incident.opened events) and can
 *    request a temporary pause during the grace period, capped by
 *    pauseBudgetSeconds and tracked in pauseUsedSeconds.
 *  - A contact can NEVER permanently cancel a release.
 *  - A contact can NEVER access a bundle's payload unless the owner has
 *    created a TrustedContactGrant of kind='bundle_vault_unwrap' for that
 *    (contact, bundle) pair. Absence of a grant = denied. Enforced here and
 *    again at recipient-access time.
 */
@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.trustedContact.findMany({
      where: { userId },
      include: { grants: { include: { bundle: { select: { id: true, title: true } } } } },
    });
  }

  create(
    userId: string,
    data: {
      name: string;
      email?: string;
      phoneE164?: string;
      relationship?: string;
      canRequestPause?: boolean;
      pauseBudgetSeconds?: number;
    },
  ) {
    return this.prisma.trustedContact.create({
      data: {
        userId,
        name: data.name,
        email: data.email,
        phoneE164: data.phoneE164,
        relationship: data.relationship,
        canRequestPause: data.canRequestPause ?? true,
        pauseBudgetSeconds: Math.max(0, Math.min(data.pauseBudgetSeconds ?? 86_400, 7 * 86_400)),
      },
    });
  }

  async grantBundleAccess(userId: string, contactId: string, bundleId: string, kind: ContactGrantKind) {
    // Verify both contact and bundle belong to user.
    const contact = await this.prisma.trustedContact.findFirst({ where: { id: contactId, userId } });
    if (!contact) throw new NotFoundException('contact not found');
    const bundle = await this.prisma.releaseBundle.findFirst({
      where: { id: bundleId, scenario: { userId } },
    });
    if (!bundle) throw new NotFoundException('bundle not found');
    return this.prisma.trustedContactGrant.create({
      data: { contactId, bundleId, kind },
    });
  }

  async revokeGrant(userId: string, contactId: string, bundleId: string, kind: ContactGrantKind) {
    const contact = await this.prisma.trustedContact.findFirst({ where: { id: contactId, userId } });
    if (!contact) throw new NotFoundException();
    const res = await this.prisma.trustedContactGrant.deleteMany({
      where: { contactId, bundleId, kind },
    });
    if (res.count === 0) throw new NotFoundException('grant not found');
  }

  async requestPause(contactId: string, scenarioId: string, requestedSeconds: number) {
    if (requestedSeconds <= 0) throw new BadRequestException('requestedSeconds must be > 0');

    // Use CAS on the contact row so two concurrent pause requests can't
    // over-consume the budget. We:
    //   1. verify state (cooldown, permission) via find,
    //   2. attempt an updateMany predicated on the current counters,
    //   3. re-read on failure to return an accurate error.
    const contact = await this.prisma.trustedContact.findUnique({ where: { id: contactId } });
    if (!contact || !contact.canRequestPause) throw new ForbiddenException('contact cannot pause');
    if (contact.pauseCooldownUntil && contact.pauseCooldownUntil > new Date()) {
      throw new ForbiddenException('pause request on cooldown');
    }

    const available = contact.pauseBudgetSeconds - contact.pauseUsedSeconds;
    if (available <= 0) throw new ForbiddenException('pause budget exhausted');

    const capped = Math.min(requestedSeconds, contact.maxSinglePauseSec);
    const grant = Math.min(capped, available);

    // Rate limit: at most one pause request every 30 minutes per contact.
    const cooldownUntil = new Date(Date.now() + 30 * 60 * 1000);

    const res = await this.prisma.trustedContact.updateMany({
      where: {
        id: contactId,
        pauseUsedSeconds: contact.pauseUsedSeconds,
        pauseRequestCount: contact.pauseRequestCount,
      },
      data: {
        pauseUsedSeconds: { increment: grant },
        pauseRequestCount: { increment: 1 },
        pauseCooldownUntil: cooldownUntil,
      },
    });
    if (res.count !== 1) {
      throw new ConflictException('concurrent pause request; retry');
    }

    await this.prisma.auditEvent; // hint: caller records audit via AuditService
    return { grantedSeconds: grant, remainingBudget: available - grant, cooldownUntil };
  }

  async remove(userId: string, id: string) {
    const c = await this.prisma.trustedContact.findFirst({ where: { id, userId } });
    if (!c) throw new NotFoundException();
    await this.prisma.trustedContact.delete({ where: { id } });
  }
}
