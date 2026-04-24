import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { BundlesService } from '../bundles/bundles.service';
import { EnvelopeService } from '../crypto/envelope.service';
import {
  buildAttachmentAadV2,
  sanitizeFilename,
  sniffMime,
} from './attachment-mime';

export interface UploadedAttachmentFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/**
 * Server-sealed attachment path (encryptionMode = action_envelope):
 *   - Client POSTs a file via multipart upload.
 *   - We sniff mime + sanitize filename, then envelope-seal the bytes via
 *     the KMS-backed EnvelopeService (same model as BundleMessage). The AAD
 *     is v2: bundleId|attachmentId|mimeType|displayFilename — so a tampered
 *     DB row cannot silently relabel the file.
 *   - Ciphertext is written to local disk under BLOB_ROOT; the DB row
 *     stores blob ref + content-addressed hash + metadata. The attachment
 *     becomes releasable to recipients via AttachmentReleaseIssuer +
 *     AttachmentDownloadService at release time.
 *
 * This is DISTINCT from PrivateVaultItem (true client-side E2EE).
 */
@Injectable()
export class AttachmentsService {
  private readonly log = new Logger('AttachmentsService');
  private readonly blobRoot: string;
  private readonly maxBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly bundles: BundlesService,
    private readonly envelope: EnvelopeService,
  ) {
    this.blobRoot =
      this.config.get<string>('BLOB_STORAGE_PATH') ??
      path.resolve(process.cwd(), 'data', 'blobs');
    this.maxBytes = this.config.get<number>('MAX_ATTACHMENT_BYTES') ?? 10 * 1024 * 1024;
    fs.mkdirSync(this.blobRoot, { recursive: true });
  }

  async list(userId: string, bundleId: string) {
    await this.bundles.requireBundle(userId, bundleId);
    return this.prisma.bundleAttachment.findMany({
      where: { bundleId },
      select: {
        id: true,
        blobRef: true,
        ciphertextHash: true,
        sizeBytes: true,
        mimeType: true,
        displayFilename: true,
        encryptionMode: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async upload(userId: string, bundleId: string, file: UploadedAttachmentFile) {
    const bundle = await this.bundles.requireBundle(userId, bundleId);
    if (!file || !file.buffer || file.size === 0) {
      throw new BadRequestException('file is empty');
    }
    if (file.size > this.maxBytes) {
      throw new BadRequestException(`file exceeds max ${this.maxBytes} bytes`);
    }

    const attachmentId = crypto.randomUUID();
    const displayFilename = sanitizeFilename(file.originalname);
    const sniffed = sniffMime(file.buffer);
    const clientMime = (file.mimetype || '').slice(0, 200);
    // Trust sniffed mime; record client claim separately for visibility.
    const mimeType = sniffed;

    const aad = buildAttachmentAadV2({
      bundleId: bundle.id,
      attachmentId,
      mimeType,
      displayFilename,
    });
    const sealed = await this.envelope.seal(file.buffer, aad);

    // Layout: [u16 nonceLen][nonce][u16 wrappedDekLen][wrappedDek][ciphertext+tag]
    const nonceLen = Buffer.alloc(2);
    nonceLen.writeUInt16BE(sealed.nonce.length, 0);
    const dekLen = Buffer.alloc(2);
    dekLen.writeUInt16BE(sealed.wrappedDek.length, 0);
    const blob = Buffer.concat([nonceLen, sealed.nonce, dekLen, sealed.wrappedDek, sealed.ciphertext]);

    const blobName = `${attachmentId}.bin`;
    const blobPath = path.join(this.blobRoot, blobName);
    await fs.promises.writeFile(blobPath, blob, { flag: 'wx' });

    const hash = crypto.createHash('sha256').update(sealed.ciphertext).digest('hex');

    const row = await this.prisma.bundleAttachment.create({
      data: {
        id: attachmentId,
        bundleId: bundle.id,
        blobRef: `local:${blobName}`,
        ciphertextHash: hash,
        sizeBytes: file.size,
        mimeType,
        clientMimeType: clientMime || null,
        displayFilename,
        encryptionMode: 'action_envelope',
        aadVersion: 2,
      },
      select: {
        id: true,
        blobRef: true,
        ciphertextHash: true,
        sizeBytes: true,
        mimeType: true,
        displayFilename: true,
        encryptionMode: true,
        createdAt: true,
      },
    });

    this.log.log(
      `attachment ${row.id} sealed for bundle ${bundle.id} (${file.size} bytes, sniffed=${mimeType}, client=${clientMime || 'none'})`,
    );
    return { ...row, filename: displayFilename };
  }

  async remove(userId: string, bundleId: string, attachmentId: string) {
    await this.bundles.requireBundle(userId, bundleId);
    const row = await this.prisma.bundleAttachment.findFirst({
      where: { id: attachmentId, bundleId },
    });
    if (!row) throw new NotFoundException('attachment not found');

    await this.prisma.bundleAttachment.delete({ where: { id: row.id } });

    if (row.blobRef.startsWith('local:')) {
      const blobName = row.blobRef.slice('local:'.length);
      const blobPath = path.join(this.blobRoot, blobName);
      await fs.promises.rm(blobPath, { force: true });
    }
    return { ok: true };
  }
}
