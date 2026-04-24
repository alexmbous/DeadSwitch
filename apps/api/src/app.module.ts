import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { envSchema } from './config/env';
import { PrismaModule } from './modules/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { ScenariosModule } from './modules/scenarios/scenarios.module';
import { BundlesModule } from './modules/bundles/bundles.module';
import { MessagesModule } from './modules/messages/messages.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { VaultModule } from './modules/vault/vault.module';
import { EscalationModule } from './modules/escalation/escalation.module';
import { ReleasesModule } from './modules/releases/releases.module';
import { AuditModule } from './modules/audit/audit.module';
import { CryptoModule } from './modules/crypto/crypto.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { StateMachineModule } from './modules/state/state.module';
import { RecipientsModule } from './modules/recipients/recipients.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { ObservabilityModule } from './observability/observability.module';
import { RequestLoggerInterceptor } from './observability/request-logger.interceptor';
import { SafetyModule } from './modules/safety/safety.module';
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (cfg) => envSchema.parse(cfg),
    }),
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 20 },
      { name: 'medium', ttl: 60_000, limit: 300 },
    ]),
    BullModule.forRoot({
      connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' },
    }),
    PrismaModule,
    StateMachineModule,
    OutboxModule,
    SessionsModule,
    SafetyModule,
    CryptoModule,
    ProvidersModule,
    AuditModule,
    AuthModule,
    UsersModule,
    ContactsModule,
    ScenariosModule,
    BundlesModule,
    MessagesModule,
    AttachmentsModule,
    VaultModule,
    EscalationModule,
    ReleasesModule,
    RecipientsModule,
    WebhooksModule,
    ObservabilityModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggerInterceptor },
  ],
})
export class AppModule {}
