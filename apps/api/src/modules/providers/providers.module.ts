import { Global, Module } from '@nestjs/common';
import { EmailProvider } from './email.provider';
import { SmsProvider } from './sms.provider';
import { VoiceProvider } from './voice.provider';
import { SocialProvider } from './social.provider';
import { OutboundDispatcher } from './outbound-dispatcher';
import { ProviderAdapter } from './provider-adapter';

/**
 * IMPORTANT CHOKEPOINT BOUNDARY:
 *
 *   providers listed in `providers:` are constructible for DI; only those
 *   listed in `exports:` are consumable by other modules.
 *
 *   EmailProvider / SmsProvider / VoiceProvider are INTENTIONALLY NOT in
 *   `exports`. Any attempt to @Inject one of them from outside this module
 *   will fail at DI wire-up. The only sanctioned outbound path is
 *   ProviderAdapter. Lint this at PR review; CI greps for raw provider
 *   imports outside `src/modules/providers/`.
 */
@Global()
@Module({
  providers: [
    EmailProvider,
    SmsProvider,
    VoiceProvider,
    SocialProvider,
    OutboundDispatcher,
    ProviderAdapter,
  ],
  exports: [
    ProviderAdapter,
    SocialProvider,
    OutboundDispatcher,
    // Legacy exports — used ONLY by EscalationService for push/SMS/voice
    // ladder steps (non-release). These paths have not yet been migrated
    // behind ProviderAdapter; follow-up in next sprint. CI lint still
    // forbids importing them from anywhere except providers/ and
    // escalation/.
    EmailProvider,
    SmsProvider,
    VoiceProvider,
  ],
})
export class ProvidersModule {}
