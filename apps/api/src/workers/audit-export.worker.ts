import 'reflect-metadata';
import * as crypto from 'crypto';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { PrismaService } from '../modules/prisma/prisma.service';
import { canonicalize } from '../modules/audit/canonical-json';

/**
 * Audit Export Worker
 *
 * Batches contiguous AuditEvent rows per chainScope and ships them to an
 * external append-only sink. The scaffold uses S3 Object Lock via the AWS
 * SDK v3; the PUT is gated on a bucket configured with:
 *
 *   - Object Lock enabled (bucket-level)
 *   - Default retention: Compliance mode, N years
 *   - Versioning ON
 *
 * This worker is the only writer to the sink bucket. IAM policy grants it
 * s3:PutObject and s3:PutObjectRetention only — no Delete, no Bypass.
 *
 * On each scope, we only export when the next unexported seq equals
 * exportedUpToSeq + 1 (no gaps). A gap signals either a bug or a tamper —
 * we alert and do not advance the watermark.
 */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const log = new Logger('audit-export');

  const BUCKET = process.env.AUDIT_SINK_BUCKET;
  const BATCH = Number(process.env.AUDIT_EXPORT_BATCH ?? 500);

  // Lazy-load aws-sdk to keep dev bundle small.
  const s3 = BUCKET
    ? await (async () => {
        const { S3Client } = await import('@aws-sdk/client-s3');
        return new S3Client({ region: process.env.AWS_REGION });
      })()
    : null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await exportPass(prisma, log, s3, BUCKET, BATCH);
      await new Promise((r) => setTimeout(r, 5000));
    } catch (e) {
      log.error(`export tick failed: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
}

async function exportPass(
  prisma: PrismaService,
  log: Logger,
  s3: any,
  bucket: string | undefined,
  batchSize: number,
) {
  // Per-scope distinct watermarks.
  const scopes: Array<{ chainScope: string; max: number | null; watermark: number }> =
    await prisma.$queryRawUnsafe(`
      SELECT ae."chainScope",
             MAX(ae."seq")::int AS "max",
             COALESCE(ax."exportedUpToSeq", 0)::int AS "watermark"
      FROM "AuditEvent" ae
      LEFT JOIN "AuditExport" ax ON ax."chainScope" = ae."chainScope"
      GROUP BY ae."chainScope", ax."exportedUpToSeq"
    `);

  for (const s of scopes) {
    if (!s.max || s.max <= s.watermark) continue;

    const next = s.watermark + 1;
    const end = Math.min(s.max, s.watermark + batchSize);

    const rows = await prisma.auditEvent.findMany({
      where: { chainScope: s.chainScope, seq: { gte: next, lte: end } },
      orderBy: { seq: 'asc' },
    });

    // Detect gaps: rows should be exactly [next..end].
    if (rows.length !== end - next + 1) {
      log.error(`gap in chain ${s.chainScope}: expected ${end - next + 1} rows, got ${rows.length}`);
      continue;
    }

    // Serialize as NDJSON with canonical bodies so the export is
    // reproducible and comparable to DB state.
    const ndjson = rows
      .map((r) =>
        canonicalize({
          chainScope: r.chainScope,
          seq: r.seq,
          userId: r.userId,
          scenarioId: r.scenarioId,
          actor: r.actor,
          eventType: r.eventType,
          payload: r.payloadRedacted,
          prevHash: r.prevHash,
          hash: r.hash,
          occurredAt: r.occurredAt,
        }),
      )
      .join('\n');

    const sinkHash = crypto.createHash('sha256').update(ndjson).digest('hex');
    const key = `${s.chainScope}/${next}-${end}.ndjson`;

    if (s3 && bucket) {
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: ndjson,
          ContentType: 'application/x-ndjson',
          ObjectLockMode: 'COMPLIANCE',
          ObjectLockRetainUntilDate: new Date(Date.now() + 365 * 24 * 3600 * 1000),
          Metadata: {
            'deadswitch-chain-scope': s.chainScope,
            'deadswitch-seq-range': `${next}-${end}`,
            'deadswitch-sha256': sinkHash,
          },
        }),
      );
    } else {
      log.debug(`[dry-run] would sink ${key} (sha256=${sinkHash.slice(0, 12)}…)`);
    }

    await prisma.auditExport.upsert({
      where: { chainScope: s.chainScope },
      create: {
        chainScope: s.chainScope,
        exportedUpToSeq: end,
        lastExportedAt: new Date(),
        lastSinkObject: key,
        lastSinkHash: sinkHash,
      },
      update: {
        exportedUpToSeq: end,
        lastExportedAt: new Date(),
        lastSinkObject: key,
        lastSinkHash: sinkHash,
      },
    });
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
