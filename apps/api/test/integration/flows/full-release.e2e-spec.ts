import { makeHarness, Harness } from '../harness';
import {
  seedFullReleaseFixture,
  putScenarioInReleaseInProgress,
} from '../helpers/seed';

/**
 * PART 10 — Sample 1
 *
 * Full release flow: given a release in executing state with one action,
 * the executor must:
 *  - decrypt (via VaultDecryptor chokepoint)
 *  - dispatch exactly once (via ProviderAdapter chokepoint)
 *  - mark action executed
 *  - complete the release
 *  - emit a chained audit trail
 *  - NOT end up with sent_after_abort
 */
describe('full release flow', () => {
  let h: Harness;
  beforeAll(async () => { h = await makeHarness(); });
  afterAll(async () => { await h.close(); });
  beforeEach(async () => { await h.reset(); });

  it('dispatches one message, marks action executed, completes release', async () => {
    const seeded = await seedFullReleaseFixture(h);
    await putScenarioInReleaseInProgress(h, seeded.scenarioId, seeded.releaseId);

    await h.executor.run(seeded.actionId, 1);

    // 1) Provider called exactly once.
    expect(h.email.calls).toHaveLength(1);
    expect(h.email.calls[0].to).toBe('dest@test.local');
    expect(h.email.calls[0].body).toContain('This is the released message body.');

    // 2) Action terminal=executed with a providerMessageId.
    const action = await h.prisma.releaseAction.findUniqueOrThrow({ where: { id: seeded.actionId } });
    expect(action.state).toBe('executed');
    expect(action.providerMessageId).toMatch(/^sg-release_action:/);
    expect(action.attempts).toBe(1);

    // 3) Release completed + scenario released.
    const release = await h.prisma.release.findUniqueOrThrow({ where: { id: seeded.releaseId } });
    expect(release.state).toBe('completed');
    expect(release.completedAt).not.toBeNull();
    const scenario = await h.prisma.scenario.findUniqueOrThrow({ where: { id: seeded.scenarioId } });
    expect(scenario.state).toBe('released');
    expect(scenario.releasedAt).not.toBeNull();

    // 4) Idempotency: OutboundDispatch row stored with status=sent exactly
    //    once for this attempt's key.
    const dispatches = await h.prisma.outboundDispatch.findMany();
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].status).toBe('sent');
    expect(dispatches[0].idempotencyKey).toBe(`release_action:${seeded.actionId}:1`);

    // 5) Audit chain complete and verifies.
    const scope = `scenario:${seeded.scenarioId}`;
    const verification = await h.audit.verifyChain(scope);
    expect(verification).toBeNull();

    // 6) Key audit events present and in order.
    const events = await h.prisma.auditEvent.findMany({
      where: { chainScope: scope },
      orderBy: { seq: 'asc' },
      select: { eventType: true },
    });
    const types = events.map((e) => e.eventType);
    expect(types).toEqual(expect.arrayContaining([
      'release.action.decrypt',
      'release.action.executed',
      'release.completed',
    ]));
    // No sent_after_abort.
    expect(types).not.toContain('release.action.sent_after_abort');
  });

  it('idempotency: running the same action twice does not double-send', async () => {
    const seeded = await seedFullReleaseFixture(h);
    await putScenarioInReleaseInProgress(h, seeded.scenarioId, seeded.releaseId);

    await h.executor.run(seeded.actionId, 1);
    // Terminal; second invocation must be a no-op.
    await h.executor.run(seeded.actionId, 1);

    expect(h.email.calls).toHaveLength(1);
    const action = await h.prisma.releaseAction.findUniqueOrThrow({ where: { id: seeded.actionId } });
    expect(action.state).toBe('executed');
  });
});
