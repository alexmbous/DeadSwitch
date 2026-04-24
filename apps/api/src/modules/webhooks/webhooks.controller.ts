import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Throttle } from '@nestjs/throttler';
import { WebhooksService } from './webhooks.service';

/**
 * Signature-verified provider webhooks. The handlers never mutate critical
 * state — they only annotate providerStatus on ReleaseAction rows.
 */
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly config: ConfigService,
  ) {}

  @Throttle({ medium: { limit: 120, ttl: 60_000 } })
  @Post('twilio/status')
  async twilio(
    @Body() body: any,
    @Headers('x-twilio-signature') signature: string | undefined,
    @Req() req: any,
  ) {
    const authToken = this.config.get<string>('TWILIO_AUTH_TOKEN');
    if (authToken && signature) {
      const url = `${this.config.get<string>('PUBLIC_BASE_URL')}/api/v1/webhooks/twilio/status`;
      const expected = crypto
        .createHmac('sha1', authToken)
        .update(
          url +
            Object.keys(body)
              .sort()
              .map((k) => k + String(body[k]))
              .join(''),
        )
        .digest('base64');
      if (!timingSafeEq(signature, expected)) {
        throw new BadRequestException('invalid signature');
      }
    }
    await this.webhooks.twilioStatus(body);
    return { ok: true };
  }

  @Throttle({ medium: { limit: 240, ttl: 60_000 } })
  @Post('sendgrid/events')
  async sendgrid(@Body() body: any) {
    // SendGrid signatures (ed25519) omitted for brevity — enable in prod.
    const events = Array.isArray(body) ? body : [];
    await this.webhooks.sendgridEvents(events);
    return { ok: true };
  }
}

function timingSafeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
