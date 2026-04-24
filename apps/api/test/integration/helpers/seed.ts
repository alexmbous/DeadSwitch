import { Harness } from '../harness';
import { EnvelopeService } from '../../../src/modules/crypto/envelope.service';
import { randomUUID } from 'crypto';

/**
 * Minimal seed helpers. These create a user, an armed scenario, and a
 * release bundle with one envelope-encrypted email message, wired to a
 * recipient. Tests can then advance the scenario through the state
 * machine and invoke the executor directly.
 */
export interface Seeded {
  userId: string;
  scenarioId: string;
  bundleId: string;
  recipientId: string;
  messageId: string;
  actionId: string;
  releaseId: string;
}

export async function seedFullReleaseFixture(h: Harness): Promise<Seeded> {
  const env = h.app.get(EnvelopeService);

  // 1. User
  const userId = randomUUID();
  const user = await h.prisma.user.create({
    data: {
      id: userId,
      email: `u-${userId}@test.local`,
      phoneE164: '+15550000000',
      displayName: 'Test User',
      passwordHash: 'x',
    },
  });

  // 2. Scenario (start in grace_period; tests that need earlier states
  // create their own using scenarios.service.arm() + the state machine)
  const scenarioId = randomUUID();
  await h.prisma.scenario.create({
    data: {
      id: scenarioId,
      userId: user.id,
      name: 'E2E',
      state: 'grace_period',
      checkinIntervalSeconds: 3600,
      gracePeriodSeconds: 3600,
      armedAt: new Date(),
      incidentOpenedAt: new Date(),
    },
  });

  // 3. Bundle + recipient
  const bundleId = randomUUID();
  await h.prisma.releaseBundle.create({
    data: { id: bundleId, scenarioId, title: 'B' },
  });
  const recipientId = randomUUID();
  await h.prisma.bundleRecipient.create({
    data: {
      id: recipientId,
      bundleId,
      recipientKind: 'email',
      address: 'dest@test.local',
      accessMethod: 'direct',
    },
  });

  // 4. Envelope-encrypted message
  const messageId = randomUUID();
  const aad = `${bundleId}|${messageId}|email`;
  const sealed = await env.seal('This is the released message body.', aad);
  await h.prisma.bundleMessage.create({
    data: {
      id: messageId,
      bundleId,
      recipientId,
      channel: 'email',
      subject: 'hi',
      messageCiphertext: sealed.ciphertext,
      messageNonce: sealed.nonce,
      messageDekWrapped: sealed.wrappedDek,
    },
  });

  // 5. Release + action (caller decides when to advance scenario to
  // release_in_progress; we create the shell so executor has targets).
  const releaseId = randomUUID();
  await h.prisma.release.create({
    data: { id: releaseId, scenarioId, triggerReason: 'test', state: 'pending' },
  });
  const actionId = randomUUID();
  await h.prisma.releaseAction.create({
    data: {
      id: actionId,
      releaseId,
      bundleId,
      messageId,
      recipientId,
      state: 'pending',
    },
  });

  return { userId, scenarioId, bundleId, recipientId, messageId, actionId, releaseId };
}

/**
 * Move scenario and release to an executing state so executor.run can
 * proceed. Bypasses the state machine for setup concision; tests that
 * need to exercise state transitions use the services directly instead.
 */
export async function putScenarioInReleaseInProgress(h: Harness, scenarioId: string, releaseId: string) {
  await h.prisma.$executeRawUnsafe(
    `UPDATE "Scenario" SET state='release_in_progress' WHERE id='${scenarioId}'`,
  );
  await h.prisma.$executeRawUnsafe(
    `UPDATE "Release" SET state='executing' WHERE id='${releaseId}'`,
  );
}
