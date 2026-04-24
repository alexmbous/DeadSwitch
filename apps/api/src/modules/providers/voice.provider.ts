import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PermanentSendError, TemporarySendError } from './outbound-dispatcher';

@Injectable()
export class VoiceProvider {
  private readonly log = new Logger(VoiceProvider.name);

  constructor(private readonly config: ConfigService) {}

  async call(
    to: string,
    prompt: string,
    idempotencyKey: string,
  ): Promise<{ provider: string; providerMessageId: string }> {
    const sid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const token = this.config.get<string>('TWILIO_AUTH_TOKEN');
    const from = this.config.get<string>('TWILIO_FROM_NUMBER');
    const callback = this.config.get<string>('TWILIO_VOICE_CALLBACK_URL');
    if (!sid || !token || !from || !callback) {
      this.log.warn(`[voice:noop] to=${to} key=${idempotencyKey}`);
      return { provider: 'noop', providerMessageId: `noop-${idempotencyKey}` };
    }
    try {
      const twilio = await import('twilio');
      const client = twilio.default(sid, token);
      const res = await client.calls.create({ to, from, url: callback });
      return { provider: 'twilio', providerMessageId: res.sid };
    } catch (err: any) {
      const code = err?.status ?? err?.statusCode;
      if (typeof code === 'number' && code >= 400 && code < 500 && code !== 429) {
        throw new PermanentSendError(`twilio voice ${code}: ${err.message}`);
      }
      throw new TemporarySendError(err?.message ?? 'twilio voice error');
    }
  }
}
