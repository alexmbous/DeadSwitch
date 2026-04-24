import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { Harness } from '../harness';
import { buildAttachmentAadV2 } from '../../../src/modules/attachments/attachment-mime';

/**
 * Test-only attachment seed. Produces a BundleAttachment row + matching
 * on-disk ciphertext blob whose wrappedDek is wrapped by the same mock
 * master key the FakeKmsService uses ("deaddrop-test-kms"). This bypasses
 * the production AttachmentsService.upload code path (which requires the
 * 'api' role to call kms.wrap) so tests can run inside the harness's
 * 'release-worker' role context.
 *
 * The format on disk is identical to what AttachmentsService.upload
 * produces, so AttachmentReleaseIssuer + AttachmentDownloadService both
 * consume it through their normal code paths.
 */
export interface SeededAttachment {
  id: string;
  bundleId: string;
  blobPath: string;
  plaintext: Buffer;
}

const TEST_MASTER_KEY = crypto.createHash('sha256').update('deaddrop-test-kms').digest();

function wrapDek(dek: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', TEST_MASTER_KEY, iv);
  const ct = Buffer.concat([c.update(dek), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

export async function seedAttachment(args: {
  h: Harness;
  bundleId: string;
  displayFilename: string;
  mimeType: string;
  plaintext: Buffer;
}): Promise<SeededAttachment> {
  const { h, bundleId, displayFilename, mimeType, plaintext } = args;
  const id = crypto.randomUUID();

  const dek = crypto.randomBytes(32);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, nonce);
  cipher.setAAD(Buffer.from(buildAttachmentAadV2({
    bundleId, attachmentId: id, mimeType, displayFilename,
  }), 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const ciphertext = Buffer.concat([body, cipher.getAuthTag()]);
  const wrapped = wrapDek(dek);
  dek.fill(0);

  // Layout: [u16 nonceLen][nonce][u16 dekLen][wrappedDek][ciphertext+tag]
  const nl = Buffer.alloc(2); nl.writeUInt16BE(nonce.length, 0);
  const wl = Buffer.alloc(2); wl.writeUInt16BE(wrapped.length, 0);
  const blob = Buffer.concat([nl, nonce, wl, wrapped, ciphertext]);

  const blobRoot = process.env.BLOB_STORAGE_PATH!;
  fs.mkdirSync(blobRoot, { recursive: true });
  const blobPath = path.join(blobRoot, `${id}.bin`);
  await fs.promises.writeFile(blobPath, blob, { flag: 'w' });

  await h.prisma.bundleAttachment.create({
    data: {
      id,
      bundleId,
      blobRef: `local:${id}.bin`,
      ciphertextHash: crypto.createHash('sha256').update(ciphertext).digest('hex'),
      sizeBytes: plaintext.length,
      mimeType,
      clientMimeType: mimeType,
      displayFilename,
      encryptionMode: 'action_envelope',
      aadVersion: 2,
    },
  });

  return { id, bundleId, blobPath, plaintext };
}
