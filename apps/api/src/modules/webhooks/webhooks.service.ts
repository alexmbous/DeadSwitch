import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Maps provider delivery status updates onto ReleaseAction.providerStatus.
 * This is observational only — we never transition ReleaseAction.state from
 * executed to anything else based on webhook. A `failed` / `undelivered`
 * provider status only sets providerStatus so operators can see it.
 */
@Injectable()
export class WebhooksService {
  private readonly log = new Logger(WebhooksService.name);

  constructor(private readonly prisma: PrismaService) {}

  async twilioStatus(payload: {
    MessageSid?: string;
    MessageStatus?: string;
    ErrorCode?: string;
  }) {
    if (!payload.MessageSid || !payload.MessageStatus) return;
    const mapped = mapTwilioStatus(payload.MessageStatus);
    const res = await this.prisma.releaseAction.updateMany({
      where: { providerMessageId: payload.MessageSid },
      data: { providerStatus: mapped, providerStatusAt: new Date() },
    });
    if (res.count === 0) {
      // Unknown SID: log but do not create. Could be an escalation SMS.
      this.log.debug(`twilio webhook: unknown sid ${payload.MessageSid}`);
    }
  }

  async sendgridEvents(events: Array<{ sg_message_id?: string; event?: string }>) {
    for (const ev of events) {
      if (!ev.sg_message_id || !ev.event) continue;
      const shortId = ev.sg_message_id.split('.')[0]; // sendgrid appends a suffix
      const mapped = mapSendgridStatus(ev.event);
      await this.prisma.releaseAction.updateMany({
        where: { providerMessageId: { startsWith: shortId } },
        data: { providerStatus: mapped, providerStatusAt: new Date() },
      });
    }
  }
}

function mapTwilioStatus(s: string): string {
  switch (s) {
    case 'queued':
    case 'sending':
    case 'sent':
      return s;
    case 'delivered':
      return 'delivered';
    case 'undelivered':
    case 'failed':
      return 'failed';
    default:
      return s;
  }
}

function mapSendgridStatus(s: string): string {
  switch (s) {
    case 'processed':
    case 'deferred':
      return 'accepted';
    case 'delivered':
      return 'delivered';
    case 'bounce':
    case 'dropped':
    case 'blocked':
      return 'failed';
    default:
      return s;
  }
}
