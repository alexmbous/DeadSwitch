import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * KMS abstraction enforcing a strict IAM split:
 *  - API / checkins / escalation workers:   encrypt-only (wrap DEKs on ingest).
 *  - Release worker:                         decrypt-only (unwrap at release).
 *
 * Policy enforcement happens at two layers:
 *  1. Configuration — env validation refuses to start a non-release role with
 *     a DECRYPT ARN, or a release role without one.
 *  2. Runtime — this service checks PROCESS_ROLE before every op and throws
 *     if the role is not entitled to the operation it attempted.
 *
 * ## Memory zeroing (important caveat)
 * Node.js `Buffer.fill(0)` is best-effort. The V8 garbage collector is free to
 * move buffers around before we zero them, and compiler optimizations may elide
 * the write. We still zero because it's cheap and reduces the window of
 * exposure, but we do NOT claim plaintext keys are unrecoverable from a core
 * dump. Mitigations:
 *   - Keep plaintext DEKs alive for the minimum possible window (single fn).
 *   - Never log, serialize, or re-use DEK buffers.
 *   - Release worker runs with core dumps disabled (ulimit -c 0) and swap
 *     disabled in production.
 */
@Injectable()
export class KmsService implements OnModuleInit {
  private readonly log = new Logger(KmsService.name);
  private readonly mode: 'mock' | 'aws';
  private readonly role: string;
  private readonly mockMasterKey?: Buffer;

  constructor(private readonly config: ConfigService) {
    this.mode = (config.get('KMS_MODE') ?? 'mock') as 'mock' | 'aws';
    this.role = (config.get('PROCESS_ROLE') ?? 'api') as string;
    if (this.mode === 'mock') {
      const b64 = config.get<string>('KMS_MOCK_MASTER_KEY_BASE64');
      this.mockMasterKey = b64
        ? Buffer.from(b64, 'base64')
        : crypto.createHash('sha256').update('deaddrop-dev-kms').digest();
    }
  }

  onModuleInit() {
    const env = this.config.get<string>('NODE_ENV');
    if ((env === 'production' || env === 'staging') && this.mode === 'mock') {
      // Belt-and-suspenders: env validator should have caught this already,
      // but fail loud here too in case someone bypassed validation.
      throw new Error(`FATAL: mock KMS in ${env}. Refusing to start.`);
    }
    this.log.log(`KMS mode=${this.mode} role=${this.role}`);
  }

  async wrap(dek: Buffer): Promise<Buffer> {
    if (this.role === 'release-worker') {
      throw new Error('KMS policy: release-worker may not encrypt');
    }
    if (this.mode === 'mock') return this.mockWrap(dek);
    throw new Error('AWS KMS wrap not implemented (stub). See AWS_KMS_ACTION_KEY_ENCRYPT_ARN.');
  }

  async unwrap(wrapped: Buffer): Promise<Buffer> {
    if (this.role !== 'release-worker') {
      throw new Error(`KMS policy: role=${this.role} may not decrypt action payloads`);
    }
    if (this.mode === 'mock') return this.mockUnwrap(wrapped);
    throw new Error('AWS KMS unwrap not implemented (stub). See AWS_KMS_ACTION_KEY_DECRYPT_ARN.');
  }

  private mockWrap(dek: Buffer): Buffer {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.mockMasterKey!, iv);
    const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ct]);
  }

  private mockUnwrap(wrapped: Buffer): Buffer {
    const iv = wrapped.subarray(0, 12);
    const tag = wrapped.subarray(12, 28);
    const ct = wrapped.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.mockMasterKey!, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }
}
