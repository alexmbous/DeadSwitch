import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PermanentSendError, TemporarySendError } from './outbound-dispatcher';

export interface EmailSendResult {
  provider: 'sendgrid' | 'noop';
  providerMessageId: string;
}

/**
 * SendGrid does not natively support idempotency keys on /v3/mail/send,
 * but it returns an `X-Message-Id` on the 202 that we persist. Our
 * OutboundDispatcher provides the outer idempotency contract; we pass the
 * same key to SendGrid as a custom header purely for cross-system tracing.
 */
@Injectable()
export class EmailProvider {
  private readonly log = new Logger(EmailProvider.name);

  constructor(private readonly config: ConfigService) {}

  async send(
    to: string,
    subject: string,
    body: string,
    idempotencyKey: string,
  ): Promise<EmailSendResult> {
    const key = this.config.get<string>('SENDGRID_API_KEY');
    const from = this.config.get<string>('SENDGRID_FROM');
    if (!key || !from) {
      this.log.warn(`[email:noop] to=${to} subject=${subject} key=${idempotencyKey}`);
      return { provider: 'noop', providerMessageId: `noop-${idempotencyKey}` };
    }
    try {
      const sg = await import('@sendgrid/mail');
      sg.default.setApiKey(key);
      const [res] = await sg.default.send({
        to,
        from,
        subject,
        text: body,
        customArgs: { deadswitch_idempotency_key: idempotencyKey },
        headers: { 'X-Deadswitch-Idempotency': idempotencyKey },
      });
      const providerMessageId =
        (res.headers as any)?.['x-message-id'] ?? `sg-${Date.now()}`;
      return { provider: 'sendgrid', providerMessageId };
    } catch (err: any) {
      throw classifySendgrid(err);
    }
  }
}

function classifySendgrid(err: any): Error {
  const code = err?.code ?? err?.response?.statusCode;
  if (typeof code === 'number' && code >= 400 && code < 500 && code !== 429) {
    return new PermanentSendError(`sendgrid ${code}: ${err.message}`);
  }
  return new TemporarySendError(err?.message ?? 'sendgrid error');
}
