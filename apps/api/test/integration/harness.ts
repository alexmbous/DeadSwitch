import { Test, TestingModule } from '@nestjs/testing';
import { INestApplicationContext } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { ReleaseExecutorModule } from '../../src/modules/releases/release-executor.module';
import { EmailProvider } from '../../src/modules/providers/email.provider';
import { SmsProvider } from '../../src/modules/providers/sms.provider';
import { VoiceProvider } from '../../src/modules/providers/voice.provider';
import { KmsService } from '../../src/modules/crypto/kms.service';
import { FakeEmailProvider } from './mocks/fake-email.provider';
import { FakeSmsProvider } from './mocks/fake-sms.provider';
import { FakeVoiceProvider } from './mocks/fake-voice.provider';
import { FakeKmsService } from './mocks/fake-kms.service';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { ReleaseActionExecutor } from '../../src/modules/releases/release-action-executor.service';
import { SafetyModeService } from '../../src/modules/safety/safety-mode.service';
import { EscalationService } from '../../src/modules/escalation/escalation.service';
import { ScenariosService } from '../../src/modules/scenarios/scenarios.service';
import { RecipientsService } from '../../src/modules/recipients/recipients.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { AuditService } from '../../src/modules/audit/audit.service';
import { truncateAll } from './helpers/db';
import { clearFaults } from './helpers/fault-injection';

export interface Harness {
  module: TestingModule;
  app: INestApplicationContext;
  prisma: PrismaService;
  executor: ReleaseActionExecutor;
  safety: SafetyModeService;
  escalation: EscalationService;
  scenarios: ScenariosService;
  recipients: RecipientsService;
  admin: AdminService;
  audit: AuditService;
  email: FakeEmailProvider;
  sms: FakeSmsProvider;
  voice: FakeVoiceProvider;
  close: () => Promise<void>;
  reset: () => Promise<void>;
}

/**
 * Builds a NestJS test module with:
 *  - AppModule (real DI graph)
 *  - ReleaseExecutorModule (so tests can call the release path directly;
 *    the module imports ReleaseWorkerCryptoModule and PROCESS_ROLE is set
 *    to 'release-worker' before harness construction)
 *  - Fake providers and fake KMS swapped in for the real boundary classes
 */
export async function makeHarness(): Promise<Harness> {
  // The VaultDecryptor refuses to construct under any role except
  // 'release-worker'. For integration tests we explicitly run as that role
  // so the full release path is exercised.
  process.env.PROCESS_ROLE = 'release-worker';
  process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';

  const moduleBuilder = Test.createTestingModule({
    imports: [AppModule, ReleaseExecutorModule],
  })
    .overrideProvider(EmailProvider).useClass(FakeEmailProvider)
    .overrideProvider(SmsProvider).useClass(FakeSmsProvider)
    .overrideProvider(VoiceProvider).useClass(FakeVoiceProvider)
    .overrideProvider(KmsService).useClass(FakeKmsService);

  const module = await moduleBuilder.compile();
  const app = module.createNestApplicationContext
    ? await (module as any).createNestApplicationContext?.()
    : await module.init();
  const context = (app ?? module) as INestApplicationContext;

  const prisma = context.get(PrismaService);
  const executor = context.get(ReleaseActionExecutor);
  const safety = context.get(SafetyModeService);
  const escalation = context.get(EscalationService);
  const scenarios = context.get(ScenariosService);
  const recipients = context.get(RecipientsService);
  const admin = context.get(AdminService);
  const audit = context.get(AuditService);
  const email = context.get(EmailProvider) as unknown as FakeEmailProvider;
  const sms = context.get(SmsProvider) as unknown as FakeSmsProvider;
  const voice = context.get(VoiceProvider) as unknown as FakeVoiceProvider;

  const harness: Harness = {
    module,
    app: context,
    prisma,
    executor,
    safety,
    escalation,
    scenarios,
    recipients,
    admin,
    audit,
    email,
    sms,
    voice,
    async close() {
      await context.close();
    },
    async reset() {
      await truncateAll(prisma);
      await safety.refresh();
      clearFaults();
      email.reset();
      sms.reset();
      voice.reset();
    },
  };
  return harness;
}
