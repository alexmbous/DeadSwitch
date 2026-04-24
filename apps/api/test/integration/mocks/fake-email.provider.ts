import { Injectable } from '@nestjs/common';
import { maybeFire } from '../helpers/fault-injection';

export interface EmailCall {
  at: Date;
  to: string;
  subject: string;
  body: string;
  idempotencyKey: string;
}

@Injectable()
export class FakeEmailProvider {
  readonly calls: EmailCall[] = [];

  async send(
    to: string,
    subject: string,
    body: string,
    idempotencyKey: string,
  ): Promise<{ provider: string; providerMessageId: string }> {
    // Inject pre-call faults (timeouts, transient, permanent...).
    const maybe = maybeFire('sendgrid', { to, subject, body, idempotencyKey });
    if (maybe?.syntheticMessageId) {
      // crash_after_ack: record the call as if sent, then throw afterward.
      this.calls.push({ at: new Date(), to, subject, body, idempotencyKey });
      const { AmbiguousOutcome } = await import('../../../src/modules/providers/error-classifier');
      throw new AmbiguousOutcome('[inject post-ack crash]');
    }
    this.calls.push({ at: new Date(), to, subject, body, idempotencyKey });
    return { provider: 'sendgrid', providerMessageId: `sg-${idempotencyKey}` };
  }

  reset() { this.calls.length = 0; }
}
