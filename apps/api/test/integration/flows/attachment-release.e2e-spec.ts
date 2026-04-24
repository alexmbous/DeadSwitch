import * as fs from 'fs';
import { ForbiddenException, GoneException, NotFoundException } from '@nestjs/common';
import { makeHarness, Harness } from '../harness';
import {
  seedFullReleaseFixture,
  putScenarioInReleaseInProgress,
} from '../helpers/seed';
import { seedAttachment } from '../helpers/attachment-seed';
import { AttachmentDownloadService } from '../../../src/modules/attachments/attachment-download.service';
import { AttachmentReleaseIssuer } from '../../../src/modules/attachments/attachment-release-issuer.service';

/**
 * End-to-end exercise of the attachment release pipeline:
 *
 *   uploaded blob → release worker issues per-recipient sealed-DEK token →
 *   provider receives the body with secure-link block → recipient hits
 *   /r/:token/attachments/:id → API decrypts (no KMS) and streams.
 *
 * All tests share the same harness + reset-per-test pattern as the rest of
 * the integration suite.
 */
describe('attachment release pipeline', () => {
  let h: Harness;
  let downloads: AttachmentDownloadService;

  beforeAll(async () => {
    h = await makeHarness();
    downloads = h.app.get(AttachmentDownloadService);
  });
  afterAll(async () => { await h.close(); });
  beforeEach(async () => { await h.reset(); });

  function extractFirstUrlFor(body: string, attachmentId: string): string {
    const escaped = attachmentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = body.match(new RegExp(`https?://\\S+/${escaped}`));
    if (!match) throw new Error(`no URL for ${attachmentId} in body`);
    return match[0];
  }

  function tokenFromUrl(url: string): string {
    const m = url.match(/\/r\/([^/]+)\/attachments\//);
    if (!m) throw new Error(`no token in url ${url}`);
    return m[1];
  }

  it('release issues access tokens, email body lists secure links, recipient downloads', async () => {
    const seeded = await seedFullReleaseFixture(h);
    const a1 = await seedAttachment({
      h, bundleId: seeded.bundleId,
      displayFilename: 'memo.txt',
      mimeType: 'text/plain',
      plaintext: Buffer.from('the secret memo body', 'utf8'),
    });
    const a2 = await seedAttachment({
      h, bundleId: seeded.bundleId,
      displayFilename: 'photo.png',
      mimeType: 'image/png',
      plaintext: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(64, 7)]),
    });
    await putScenarioInReleaseInProgress(h, seeded.scenarioId, seeded.releaseId);

    await h.executor.run(seeded.actionId, 1);

    // Provider received exactly one email containing both link blocks.
    expect(h.email.calls).toHaveLength(1);
    const body = h.email.calls[0].body;
    expect(body).toContain('--- Secure file links ---');
    expect(body).toContain('memo.txt');
    expect(body).toContain('photo.png');
    const url1 = extractFirstUrlFor(body, a1.id);
    const url2 = extractFirstUrlFor(body, a2.id);
    expect(url1).toMatch(new RegExp(`/r/[^/]+/attachments/${a1.id}$`));
    expect(url2).toMatch(new RegExp(`/r/[^/]+/attachments/${a2.id}$`));

    // Two AttachmentAccessToken rows persisted, scoped correctly.
    const tokenRows = await h.prisma.attachmentAccessToken.findMany({
      where: { releaseId: seeded.releaseId },
    });
    expect(tokenRows).toHaveLength(2);
    for (const t of tokenRows) {
      expect(t.recipientId).toBe(seeded.recipientId);
      expect(t.bundleId).toBe(seeded.bundleId);
      expect(t.uses).toBe(0);
      expect(t.tokenHash.startsWith('$argon2id$')).toBe(true);
    }

    // Recipient downloads attachment 1.
    const tok1 = tokenFromUrl(url1);
    const result1 = await downloads.download(tok1, a1.id);
    expect(result1.filename).toBe('memo.txt');
    expect(result1.mimeType).toBe('text/plain');
    expect(result1.bytes.toString('utf8')).toBe('the secret memo body');

    // attachment.link_issued + attachment.downloaded audited.
    const events = await h.prisma.auditEvent.findMany({
      where: { scenarioId: seeded.scenarioId },
      select: { eventType: true },
    });
    const types = events.map((e) => e.eventType);
    expect(types).toEqual(expect.arrayContaining([
      'attachment.link_issued',
      'attachment.access_attempt',
      'attachment.downloaded',
    ]));

    // Action terminated executed; release completed.
    const action = await h.prisma.releaseAction.findUniqueOrThrow({ where: { id: seeded.actionId } });
    expect(action.state).toBe('executed');
  });

  it('release with NO attachments still completes (regression)', async () => {
    const seeded = await seedFullReleaseFixture(h);
    await putScenarioInReleaseInProgress(h, seeded.scenarioId, seeded.releaseId);

    await h.executor.run(seeded.actionId, 1);

    expect(h.email.calls).toHaveLength(1);
    expect(h.email.calls[0].body).not.toContain('--- Secure file links ---');
    const tokens = await h.prisma.attachmentAccessToken.count({ where: { releaseId: seeded.releaseId } });
    expect(tokens).toBe(0);
  });

  it('expired token is rejected', async () => {
    const seeded = await seedFullReleaseFixture(h);
    const att = await seedAttachment({
      h, bundleId: seeded.bundleId,
      displayFilename: 'memo.txt', mimeType: 'text/plain',
      plaintext: Buffer.from('hi'),
    });
    await putScenarioInReleaseInProgress(h, seeded.scenarioId, seeded.releaseId);
    await h.executor.run(seeded.actionId, 1);

    const url = extractFirstUrlFor(h.email.calls[0].body, att.id);
    const token = tokenFromUrl(url);

    await h.prisma.attachmentAccessToken.updateMany({
      where: {},
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(downloads.download(token, att.id)).rejects.toBeInstanceOf(GoneException);

    const expired = await h.prisma.auditEvent.findMany({
      where: { eventType: 'attachment.expired', scenarioId: seeded.scenarioId },
    });
    expect(expired).toHaveLength(1);
  });

  it('exhausted max-uses is rejected after the cap', async () => {
    process.env.ATTACHMENT_LINK_MAX_USES = '2';
    // Re-issue under the new cap — issuer reads max at construction so we need
    // a fresh harness only if this test runs in isolation. For the shared
    // harness here, override via direct DB write below.
    const seeded = await seedFullReleaseFixture(h);
    const att = await seedAttachment({
      h, bundleId: seeded.bundleId,
      displayFilename: 'note.txt', mimeType: 'text/plain',
      plaintext: Buffer.from('limited'),
    });
    await putScenarioInReleaseInProgress(h, seeded.scenarioId, seeded.releaseId);
    await h.executor.run(seeded.actionId, 1);

    await h.prisma.attachmentAccessToken.updateMany({ where: {}, data: { maxUses: 2 } });

    const url = extractFirstUrlFor(h.email.calls[0].body, att.id);
    const token = tokenFromUrl(url);

    await downloads.download(token, att.id);
    await downloads.download(token, att.id);
    await expect(downloads.download(token, att.id)).rejects.toBeInstanceOf(GoneException);

    const denied = await h.prisma.auditEvent.findMany({
      where: { eventType: 'attachment.access_denied', scenarioId: seeded.scenarioId },
    });
    expect(denied.length).toBeGreaterThan(0);
  });

  it('token presented for the wrong attachment is rejected with scope mismatch', async () => {
    const seeded = await seedFullReleaseFixture(h);
    const a1 = await seedAttachment({
      h, bundleId: seeded.bundleId,
      displayFilename: 'a.txt', mimeType: 'text/plain', plaintext: Buffer.from('a'),
    });
    const a2 = await seedAttachment({
      h, bundleId: seeded.bundleId,
      displayFilename: 'b.txt', mimeType: 'text/plain', plaintext: Buffer.from('b'),
    });
    await putScenarioInReleaseInProgress(h, seeded.scenarioId, seeded.releaseId);
    await h.executor.run(seeded.actionId, 1);

    const url1 = extractFirstUrlFor(h.email.calls[0].body, a1.id);
    const tok1 = tokenFromUrl(url1);

    // Present a1's token at a2's path.
    await expect(downloads.download(tok1, a2.id)).rejects.toBeInstanceOf(ForbiddenException);

    const denied = await h.prisma.auditEvent.findMany({
      where: { eventType: 'attachment.access_denied' },
    });
    expect(denied.some((e) => (e.payloadRedacted as any).reason === 'scope_mismatch')).toBe(true);
  });

  it('ciphertext tampering is detected by hash check before decrypt', async () => {
    const seeded = await seedFullReleaseFixture(h);
    const att = await seedAttachment({
      h, bundleId: seeded.bundleId,
      displayFilename: 'doc.txt', mimeType: 'text/plain',
      plaintext: Buffer.from('untouched bytes'),
    });
    await putScenarioInReleaseInProgress(h, seeded.scenarioId, seeded.releaseId);
    await h.executor.run(seeded.actionId, 1);

    const url = extractFirstUrlFor(h.email.calls[0].body, att.id);
    const token = tokenFromUrl(url);

    // Flip a byte in the ciphertext payload (last byte before tag).
    const buf = await fs.promises.readFile(att.blobPath);
    buf[buf.length - 17] ^= 0x01;
    await fs.promises.writeFile(att.blobPath, buf);

    await expect(downloads.download(token, att.id)).rejects.toBeInstanceOf(GoneException);
    const mismatches = await h.prisma.auditEvent.findMany({
      where: { eventType: 'attachment.hash_mismatch', scenarioId: seeded.scenarioId },
    });
    expect(mismatches).toHaveLength(1);
    expect((mismatches[0].payloadRedacted as any).severity).toBe('high');
  });

  it('AttachmentReleaseIssuer refuses to construct outside release-worker role', () => {
    // Smoke: imitate API role at module load. We can't tear down the harness
    // for this; just call onModuleInit() with a fake config to assert the
    // guard is present.
    const issuer: any = h.app.get(AttachmentReleaseIssuer);
    const originalRole = (issuer as any).config.get('PROCESS_ROLE');
    expect(originalRole).toBe('release-worker'); // sanity in this harness

    // Also check that a freshly-constructed instance with role=api throws.
    const fakeConfig = { get: (k: string) => (k === 'PROCESS_ROLE' ? 'api' : undefined) };
    const ctor = (Object.getPrototypeOf(issuer) as any).constructor;
    const standalone = new ctor(
      (issuer as any).prisma,
      (issuer as any).kms,
      (issuer as any).audit,
      (issuer as any).safety,
      fakeConfig,
    );
    expect(() => standalone.onModuleInit()).toThrow(/release-worker/);
  });
});

