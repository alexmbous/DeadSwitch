import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BundlesService } from '../bundles/bundles.service';

/**
 * Private vault items are end-to-end encrypted by the client.
 * Server stores opaque ciphertext + wrapped DEK (wrapped by user's KEK). It
 * CANNOT decrypt these.
 */
@Injectable()
export class VaultService {
  constructor(private readonly prisma: PrismaService, private readonly bundles: BundlesService) {}

  async upload(userId: string, bundleId: string, data: {
    ciphertextBlobRef: string;
    wrappedDek: string; // base64
    clientKeyId: string;
    nonce: string; // base64
    expiresAt?: string;
  }) {
    const bundle = await this.bundles.requireBundle(userId, bundleId);
    return this.prisma.privateVaultItem.create({
      data: {
        bundleId: bundle.id,
        ciphertextBlobRef: data.ciphertextBlobRef,
        wrappedDek: Buffer.from(data.wrappedDek, 'base64'),
        clientKeyId: data.clientKeyId,
        nonce: Buffer.from(data.nonce, 'base64'),
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      },
      select: { id: true, createdAt: true },
    });
  }
}
