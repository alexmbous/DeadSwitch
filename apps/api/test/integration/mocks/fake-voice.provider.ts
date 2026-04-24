import { Injectable } from '@nestjs/common';
import { maybeFire } from '../helpers/fault-injection';

@Injectable()
export class FakeVoiceProvider {
  readonly calls: Array<{ at: Date; to: string; prompt: string; idempotencyKey: string }> = [];

  async call(to: string, prompt: string, idempotencyKey: string) {
    maybeFire('twilio-voice', { to, prompt, idempotencyKey });
    this.calls.push({ at: new Date(), to, prompt, idempotencyKey });
    return { provider: 'twilio-voice', providerMessageId: `twv-${idempotencyKey}` };
  }

  reset() { this.calls.length = 0; }
}
