import { makeHarness, Harness } from '../harness';
import {
  seedFullReleaseFixture,
  putScenarioInReleaseInProgress,
} from '../helpers/seed';
import { injectFault } from '../helpers/fault-injection';

/**
 * PART 10 — Sample 2
 *
 * Provider timeout (classified as AmbiguousOutcome by the classifier).
 *
 * Expected:
 *  - action ends in failed_temporary with lastError starting with "ambiguous:"
 *  - breaker ambiguousCount incremented (one ambiguous fault)
 *  - provider got exactly one call (we must NOT auto-retry ambiguous)
 *  - no sent_after_abort (release was never aborted)
 *  - release stays pending (not completed) because action is non-terminal
 */
describe('failure injection: provider timeout', () => {
  let h: Harness;
  beforeAll(async () => { h = await makeHarness(); });
  afterAll(async () => { await h.close(); });
  beforeEach(async () => { await h.reset(); });

  it('treats provider timeout as ambiguous and does not retry automatically', async () => {
    const seeded = await seedFullReleaseFixture(h);
    await putScenarioInReleaseInProgress(h, seeded.scenarioId, seeded.releaseId);

    injectFault({
      provider: 'sendgrid',
      kind: 'timeout',
      label: 'single-timeout',
    });

    // The executor swallows ambiguous errors (per policy: no auto-retry).
    // It should NOT throw.
    await expect(h.executor.run(seeded.actionId, 1)).resolves.toBeUndefined();

    // Action → failed_temporary with ambiguous prefix
    const action = await h.prisma.releaseAction.findUniqueOrThrow({ where: { id: seeded.actionId } });
    expect(action.state).toBe('failed_temporary');
    expect(action.lastError ?? '').toMatch(/^ambiguous:/);

    // Breaker registered one ambiguous event.
    const breaker = await h.prisma.providerCircuitBreaker.findUniqueOrThrow({ where: { provider: 'sendgrid' } });
    expect(breaker.ambiguousCount).toBe(1);
    // Single ambiguous is below the 5/5min threshold — breaker still closed.
    expect(breaker.state).toBe('closed');

    // Provider was called exactly zero times (timeout fires BEFORE our
    // fake records the call — see fake-email.provider.ts flow).
    expect(h.email.calls).toHaveLength(0);

    // Dispatch row stays reserved (not sent, not failed).
    const dispatches = await h.prisma.outboundDispatch.findMany();
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].status).toBe('reserved');

    // No audit event for executed/sent_after_abort.
    const events = await h.prisma.auditEvent.findMany({
      where: { chainScope: `scenario:${seeded.scenarioId}` },
      select: { eventType: true },
    });
    const types = events.map((e) => e.eventType);
    expect(types).toContain('release.action.failed');
    expect(types).not.toContain('release.action.executed');
    expect(types).not.toContain('release.action.sent_after_abort');
  });

  it('opens the breaker after 5 ambiguous events within window', async () => {
    // Run five separate action sends, each hitting an ambiguous fault.
    // After the 5th, the breaker short-fuse trips.
    for (let i = 0; i < 5; i++) {
      const seeded = await seedFullReleaseFixture(h);
      await putScenarioInReleaseInProgress(h, seeded.scenarioId, seeded.releaseId);
      injectFault({ provider: 'sendgrid', kind: 'ambiguous', label: `amb-${i}` });
      await h.executor.run(seeded.actionId, 1);
    }

    const breaker = await h.prisma.providerCircuitBreaker.findUniqueOrThrow({ where: { provider: 'sendgrid' } });
    expect(breaker.state).toBe('open');
    const mode = await h.safety.current();
    expect(mode.isolatedProviders).toContain('sendgrid');
  });
});
