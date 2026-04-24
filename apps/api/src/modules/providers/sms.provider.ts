import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PermanentSendError, TemporarySendError } from './outbound-dispatcher';

/**
 * Twilio's createMessage supports an IdempotencyKey only on Accounts API,
 * not on Messages. We rely on:
 *   (a) OutboundDispatcher's DB-level reservation;
 *   (b) persisting the returned `sid` before declaring success, so that
 *       crashes between provider-ack and DB-commit leave an "ambiguous"
 *       reserved row that the operator must resolve.
 */
@Injectable()
export class SmsProvider {
  private readonly log = new Logger(SmsProvider.name);

  constructor(private readonly config: ConfigService) {}

  async send(
    to: string,
    body: string,
    idempotencyKey: string,
  ): Promise<{ provider: string; providerMessageId: string }> {
    const sid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const token = this.config.get<string>('TWILIO_AUTH_TOKEN');
    const from = this.config.get<string>('TWILIO_FROM_NUMBER');
    if (!sid || !token || !from) {
      this.log.warn(`[sms:noop] to=${to} key=${idempotencyKey}`);
      return { provider: 'noop', providerMessageId: `noop-${idempotencyKey}` };
    }
    try {
      const twilio = await import('twilio');
      const client = twilio.default(sid, token);
      const res = await client.messages.create({
        to,
        from,
        body,
        statusCallback: this.config.get<string>('TWILIO_STATUS_CALLBACK_URL'),
      });
      return { provider: 'twilio', providerMessageId: res.sid };
    } catch (err: any) {
      throw classifyTwilio(err);
    }
  }
}

function classifyTwilio(err: any): Error {
  const code = err?.status ?? err?.statusCode;
  const twilioCode = err?.code;
  // Twilio-specific permanents: invalid to number, blocked content, etc.
  if (twilioCode === 21211 || twilioCode === 21610 || twilioCode === 21612) {
    return new PermanentSendError(`twilio ${twilioCode}: ${err.message}`);
  }
  if (typeof code === 'number' && code >= 400 && code < 500 && code !== 429) {
    return new PermanentSendError(`twilio ${code}: ${err.message}`);
  }
  return new TemporarySendError(err?.message ?? 'twilio error');
}
