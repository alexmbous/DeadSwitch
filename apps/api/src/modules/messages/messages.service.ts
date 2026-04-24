import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EnvelopeService } from '../crypto/envelope.service';
import { BundlesService } from '../bundles/bundles.service';

/**
 * Ingests plaintext action payloads over TLS, immediately envelope-encrypts,
 * and writes only ciphertext + wrapped DEK to the database. Plaintext is
 * discarded before the request returns.
 */
@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly envelope: EnvelopeService,
    private readonly bundles: BundlesService,
  ) {}

  async ingest(userId: string, bundleId: string, input: {
    recipientId?: string;
    channel: 'email' | 'sms' | 'social';
    subject?: string;
    plaintext: string;
  }) {
    const bundle = await this.bundles.requireBundle(userId, bundleId);
    const messageId = cryptoRandomId();
    const aad = `${bundle.id}|${messageId}|${input.channel}`;

    const enveloped = await this.envelope.seal(input.plaintext, aad);

    const row = await this.prisma.bundleMessage.create({
      data: {
        id: messageId,
        bundleId: bundle.id,
        recipientId: input.recipientId,
        channel: input.channel,
        subject: input.subject,
        messageCiphertext: enveloped.ciphertext,
        messageNonce: enveloped.nonce,
        messageDekWrapped: enveloped.wrappedDek,
      },
      select: { id: true, channel: true, createdAt: true },
    });

    return row;
  }
}

function cryptoRandomId() {
  // 16 bytes = 32 hex chars. Sufficient for per-message uniqueness as AAD input.
  return require('crypto').randomBytes(16).toString('hex');
}
