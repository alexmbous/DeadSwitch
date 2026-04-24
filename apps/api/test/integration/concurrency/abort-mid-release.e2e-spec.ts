import { makeHarness, Harness } from '../harness';
import {
  seedFullReleaseFixture,
  putScenarioInReleaseInProgress,
} from '../helpers/seed';
import { injectFault } from '../helpers/fault-injection';

/**
 * PART 10 — Sample 3
 *
 * Race: a cancel lands AFTER the provider has ACKed but BEFORE the
 * executor finishes its post-ACK state mutation. The post-ACK recheck
 * must mark the action sent_after_abort (terminal) and write a high-sev
 * audit event — and a subsequent sibling must be aborted via IL6 by the
 * next worker pickup.
 */
describe('concurrency: abort mid-release', () => {
  let h: Harness;
  beforeAll(async () => { h = await makeHarness(); });
  afterAll(async () => { await h.close(); });
  beforeEach(async () => { await h.reset(); });

  it('sends then detects post-ACK abort, flags sent_after_abort and aborts siblings', async () => {
    // Seed a release with TWO actions so we can verify sibling containment.
    const seedA = await seedFullReleaseFixture(h);
    // Add second action to the same release.
    const recipient2 = await h.prisma.bundleRecipient.create({
      data: {
        bundleId: seedA.bundleId,
        recipientKind: 'email',
        address: 'second@test.local',
        accessMethod: 'direct',
      },
    });
    // Duplicate the envelope-sealed message for recipient2.
    const m = await h.prisma.bundleMessage.findUniqueOrThrow({ where: { id: seedA.messageId } });
    const m2 = await h.prisma.bundleMessage.create({
      data: {
        bundleId: seedA.bundleId,
        recipientId: recipient2.id,
        channel: 'email',
        subject: m.subject,
        messageCiphertext: m.messageCiphertext,
        messageNonce: m.messageNonce,
        messageDekWrapped: m.messageDekWrapped,
      },
    });
    const actionB = await h.prisma.releaseAction.create({
      data: {
        releaseId: seedA.releaseId,
        bundleId: seedA.bundleId,
        messageId: m2.id,
        recipientId: recipient2.id,
        state: 'pending',
      },
    });

    await putScenarioInReleaseInProgress(h, seedA.scenarioId, seedA.releaseId);

    // Race: the provider accepts the send, but RIGHT BEFORE the executor's
    // post-ACK transaction, an operator aborts the release. Simulate this
    // by wrapping the fake email provider's success: use `crash_after_ack`
    // to "record the call" then throw AmbiguousOutcome. That doesn't match
    // our exact scenario — instead we use a simpler injection: we patch
    // prisma.release.update to set canceledAt right before the executor's
    // post-ACK tx runs.
    //
    // We achieve deterministic ordering by using a tiny Prisma middleware
    // that flips canceledAt the first time we see a releaseAction update
    // with state='executed'. This models "the cancel landed in the window".
    const prisma = h.prisma;
    const unsubscribe = patchPostAck(prisma, seedA.releaseId);

    try {
      await h.executor.run(seedA.actionId, 1);
    } finally {
      unsubscribe();
    }

    // Provider WAS called (we didn't block the send).
    expect(h.email.calls).toHaveLength(1);

    // Action A is sent_after_abort (terminal).
    const a = await h.prisma.releaseAction.findUniqueOrThrow({ where: { id: seedA.actionId } });
    expect(a.state).toBe('sent_after_abort');
    expect(a.providerMessageId).toBeTruthy();

    // Audit emitted sent_after_abort.
    const events = await h.prisma.auditEvent.findMany({
      where: { chainScope: `scenario:${seedA.scenarioId}` },
      select: { eventType: true },
    });
    expect(events.map((e) => e.eventType)).toContain('release.action.sent_after_abort');

    // Action B (sibling) should be aborted by IL6 when the executor runs it.
    await h.executor.run(actionB.id, 1);
    const b = await h.prisma.releaseAction.findUniqueOrThrow({ where: { id: actionB.id } });
    expect(b.state).toBe('aborted');
    expect(b.lastError ?? '').toMatch(/sibling sent_after_abort/);

    // Exactly one provider call for the whole release (sibling never sent).
    expect(h.email.calls).toHaveLength(1);
  });
});

/**
 * Hooks $use middleware so that THE FIRST releaseAction update to state=executed
 * triggers a transactional cancel of the release (simulating an abort landing
 * in the pre-commit window).
 *
 * The executor's post-ACK logic runs in a transaction that reads the release
 * again — we flip canceledAt BEFORE the post-ACK commit, so the recheck sees
 * the cancel and writes sent_after_abort.
 */
function patchPostAck(prisma: any, releaseId: string) {
  const middleware = async (params: any, next: any) => {
    const before = prisma.release;
    // Trigger the cancel exactly once, when we see the adapter's
    // OutboundDispatch update to status=sent (that is the precise instant
    // AFTER the provider acked, BEFORE the action state flips to executed).
    if (
      params.model === 'OutboundDispatch' &&
      params.action === 'update' &&
      params.args?.data?.status === 'sent'
    ) {
      await prisma.release.update({
        where: { id: releaseId },
        data: { canceledAt: new Date(), canceledBy: 'test', cancelReason: 'race' },
      });
    }
    return next(params);
  };
  prisma.$use(middleware);
  // Prisma's $use cannot be unregistered; return a noop remover. In real
  // tests we recreate the harness per test via reset() so accumulated
  // middleware doesn't leak across tests. For tighter isolation use a
  // fresh `makeHarness()` per-test.
  return () => { /* best-effort — fresh harness per test recommended */ };
}
