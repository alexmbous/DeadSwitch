import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { KmsService } from './kms.service';

export interface EnvelopedPayload {
  ciphertext: Buffer;
  nonce: Buffer;
  wrappedDek: Buffer;
}

/**
 * Envelope encryption for action payloads.
 * - Generates a per-message DEK.
 * - Encrypts plaintext with AES-256-GCM (AAD-bound to caller context).
 * - Wraps the DEK via KMS. Plaintext DEK is zeroized after use.
 */
@Injectable()
export class EnvelopeService {
  constructor(private readonly kms: KmsService) {}

  async seal(plaintext: string | Buffer, aad: string): Promise<EnvelopedPayload> {
    const dek = crypto.randomBytes(32);
    try {
      const nonce = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', dek, nonce);
      cipher.setAAD(Buffer.from(aad, 'utf8'));
      const pt = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
      const body = Buffer.concat([cipher.update(pt), cipher.final()]);
      const tag = cipher.getAuthTag();
      const ciphertext = Buffer.concat([body, tag]);
      const wrappedDek = await this.kms.wrap(dek);
      return { ciphertext, nonce, wrappedDek };
    } finally {
      dek.fill(0);
    }
  }

  /** Only the Release Worker should be wired to call this (KMS decrypt permission). */
  async open(payload: EnvelopedPayload, aad: string): Promise<Buffer> {
    const dek = await this.kms.unwrap(payload.wrappedDek);
    try {
      const tag = payload.ciphertext.subarray(payload.ciphertext.length - 16);
      const body = payload.ciphertext.subarray(0, payload.ciphertext.length - 16);
      const decipher = crypto.createDecipheriv('aes-256-gcm', dek, payload.nonce);
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]);
    } finally {
      dek.fill(0);
    }
  }
}
