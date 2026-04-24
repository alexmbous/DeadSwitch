import { Injectable } from '@nestjs/common';
import { maybeFire } from '../helpers/fault-injection';

export interface SmsCall {
  at: Date;
  to: string;
  body: string;
  idempotencyKey: string;
}

@Injectable()
export class FakeSmsProvider {
  readonly calls: SmsCall[] = [];

  async send(
    to: string,
    body: string,
    idempotencyKey: string,
  ): Promise<{ provider: string; providerMessageId: string }> {
    const maybe = maybeFire('twilio-sms', { to, body, idempotencyKey });
    if (maybe?.syntheticMessageId) {
      this.calls.push({ at: new Date(), to, body, idempotencyKey });
      const { AmbiguousOutcome } = await import('../../../src/modules/providers/error-classifier');
      throw new AmbiguousOutcome('[inject post-ack crash]');
    }
    this.calls.push({ at: new Date(), to, body, idempotencyKey });
    return { provider: 'twilio-sms', providerMessageId: `twsms-${idempotencyKey}` };
  }

  reset() { this.calls.length = 0; }
}
