import { makeHarness, Harness } from '../harness';
import {
  seedFullReleaseFixture,
  putScenarioInReleaseInProgress,
} from '../helpers/seed';
import { SafetyBlockedError } from '../../../src/modules/safety/safety-mode.service';

/**
 * PART 10 — Sample 4
 *
 * Matrix coverage for every mode. For each mode we probe:
 *   - an allowed capability (must succeed)
 *   - a denied capability (must throw SafetyBlockedError)
 *
 * Entering emergency_freeze / audit_compromised is validated for auto-exit
 * refusal. Exit gate is tested in the admin suite.
 */
describe('safety mode enforcement', () => {
  let h: Harness;
  beforeAll(async () => { h = await makeHarness(); });
  afterAll(async () => { await h.close(); });
  beforeEach(async () => { await h.reset(); });

  it('release_restricted: blocks release.begin, allows release.continue_batch', async () => {
    await h.safety.enter('release_restricted', 'test', 'system', { auto: true });
    await expect(h.safety.assert('release.begin')).rejects.toBeInstanceOf(SafetyBlockedError);
    await expect(h.safety.assert('release.continue_batch')).resolves.toBeUndefined();
    await expect(h.safety.assert('scenario.arm')).resolves.toBeUndefined();
  });

  it('audit_compromised: recipient.access_existing allowed, issue_link denied', async () => {
    await h.safety.enter('audit_compromised', 'test', 'system', { auto: true });
    await expect(h.safety.assert('recipient.access_existing')).resolves.toBeUndefined();
    await expect(h.safety.assert('recipient.issue_link')).rejects.toBeInstanceOf(SafetyBlockedError);
    await expect(h.safety.assert('release.begin')).rejects.toBeInstanceOf(SafetyBlockedError);
    await expect(h.safety.assert('audit.mutation')).rejects.toBeInstanceOf(SafetyBlockedError);
  });

  it('emergency_freeze: blocks everything except admin queueing', async () => {
    await h.safety.enter('emergency_freeze', 'test', 'system', { auto: false });
    await expect(h.safety.assert('provider.email_send')).rejects.toBeInstanceOf(SafetyBlockedError);
    await expect(h.safety.assert('vault.decrypt')).rejects.toBeInstanceOf(SafetyBlockedError);
    await expect(h.safety.assert('recipient.access_existing')).rejects.toBeInstanceOf(SafetyBlockedError);
    await expect(h.safety.assert('admin.exit_protective_mode')).resolves.toBeUndefined();
  });

  it('auto-exit from audit_compromised is refused', async () => {
    await h.safety.enter('audit_compromised', 'test', 'system', { auto: true });
    await expect(
      h.safety.enter('normal', 'auto', 'system', { auto: true }),
    ).rejects.toThrow(/cannot auto-exit/);
  });

  it('provider isolation blocks one channel but leaves others', async () => {
    await h.safety.isolateProvider('sendgrid', 'test', 'system');
    const mode = await h.safety.current();
    expect(mode.isolatedProviders).toContain('sendgrid');

    // Attempt to release via sendgrid should fail at the ProviderAdapter.
    const seeded = await seedFullReleaseFixture(h);
    await putScenarioInReleaseInProgress(h, seeded.scenarioId, seeded.releaseId);
    await h.executor.run(seeded.actionId, 1);

    const action = await h.prisma.releaseAction.findUniqueOrThrow({ where: { id: seeded.actionId } });
    // First attempt hits "circuit open: sendgrid" → TransientInfraError →
    // failed_temporary.
    expect(action.state).toBe('failed_temporary');
    expect(action.lastError ?? '').toMatch(/circuit open/);
    expect(h.email.calls).toHaveLength(0);
  });

  it('vault.decrypt is blocked in release_restricted? (explicit matrix row)', async () => {
    // Matrix row says release_restricted ALLOWS vault.decrypt (in-flight
    // work continues). Confirm that explicitly.
    await h.safety.enter('release_restricted', 'test', 'system', { auto: true });
    await expect(h.safety.assert('vault.decrypt')).resolves.toBeUndefined();
  });

  it('release blocked at ProviderAdapter under emergency_freeze', async () => {
    const seeded = await seedFullReleaseFixture(h);
    await putScenarioInReleaseInProgress(h, seeded.scenarioId, seeded.releaseId);

    await h.safety.enter('emergency_freeze', 'test', 'system', { auto: false });

    // The executor will refuse at the top-level assert('release.continue_batch')
    // and throw 'safety:release.continue_batch'.
    await expect(h.executor.run(seeded.actionId, 1)).rejects.toThrow(/^safety:/);
    expect(h.email.calls).toHaveLength(0);
  });
});
