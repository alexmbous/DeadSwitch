import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { maybeFire } from '../helpers/fault-injection';

/**
 * FakeKmsService keeps the same AES-GCM mock logic as production's `mock`
 * mode, but consults the fault registry before every op so tests can
 * inject KMS failures. The PROCESS_ROLE check is preserved because
 * tests intentionally validate that IL1 works.
 */
@Injectable()
export class FakeKmsService {
  private readonly log = new Logger(FakeKmsService.name);
  private readonly masterKey: Buffer;
  private readonly role: string;

  constructor(config: ConfigService) {
    this.masterKey = crypto.createHash('sha256').update('deaddrop-test-kms').digest();
    this.role = (config.get<string>('PROCESS_ROLE') ?? 'api') as string;
  }

  async wrap(dek: Buffer): Promise<Buffer> {
    if (this.role === 'release-worker') {
      throw new Error('KMS policy: release-worker may not encrypt');
    }
    // Tests may inject on the encrypt path too if they want.
    maybeFire('kms-decrypt', { op: 'wrap' });
    return this.doWrap(dek);
  }

  async unwrap(wrapped: Buffer): Promise<Buffer> {
    if (this.role !== 'release-worker') {
      throw new Error(`KMS policy: role=${this.role} may not decrypt action payloads`);
    }
    maybeFire('kms-decrypt', { op: 'unwrap' });
    return this.doUnwrap(wrapped);
  }

  private doWrap(dek: Buffer): Buffer {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
    const ct = Buffer.concat([c.update(dek), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]);
  }

  private doUnwrap(wrapped: Buffer): Buffer {
    const iv = wrapped.subarray(0, 12);
    const tag = wrapped.subarray(12, 28);
    const ct = wrapped.subarray(28);
    const d = crypto.createDecipheriv('aes-256-gcm', this.masterKey, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
  }

  onModuleInit() {
    this.log.log(`FakeKmsService ready role=${this.role}`);
  }
}
