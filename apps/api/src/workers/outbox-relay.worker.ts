import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Queue } from 'bullmq';
import { AppModule } from '../app.module';
import { PrismaService } from '../modules/prisma/prisma.service';
import { SafetyModeService } from '../modules/safety/safety-mode.service';
import { evaluate } from '../modules/safety/safety-policy';
import { Logger } from '@nestjs/common';

/**
 * Outbox relay: drains OutboxEvent rows into BullMQ.
 *
 * Ordering:
 *   1. SELECT ... FOR UPDATE SKIP LOCKED  → claim a batch without blocking peers.
 *   2. For each row: queue.add with jobId === row.jobId (idempotent against
 *      crashes between BullMQ ack and our DB delete).
 *   3. DELETE the row on success. A BullMQ add failure leaves the row for
 *      the next pass with incremented attempts and a lockedUntil backoff.
 *
 * Safe to run multiple replicas. SKIP LOCKED guarantees no two relays pick
 * the same row.
 */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  const prisma = app.get(PrismaService);
  const safety = app.get(SafetyModeService);
  const log = new Logger('outbox-relay');

  const queues = new Map<string, Queue>();
  const connection = { url: process.env.REDIS_URL ?? 'redis://localhost:6379' };
  function q(name: string): Queue {
    let qq = queues.get(name);
    if (!qq) {
      qq = new Queue(name, { connection });
      queues.set(name, qq);
    }
    return qq;
  }

  const BATCH = 50;
  const LOCK_MS = 30_000;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const claimed: Array<{
        id: string;
        queueName: string;
        jobName: string;
        jobId: string;
        payload: any;
        availableAt: Date;
      }> = await prisma.$queryRawUnsafe(`
        WITH ready AS (
          SELECT id FROM "OutboxEvent"
          WHERE "availableAt" <= NOW()
            AND ("lockedUntil" IS NULL OR "lockedUntil" <= NOW())
          ORDER BY "availableAt"
          FOR UPDATE SKIP LOCKED
          LIMIT ${BATCH}
        )
        UPDATE "OutboxEvent" o
          SET "lockedUntil" = NOW() + INTERVAL '${LOCK_MS / 1000} seconds',
              attempts = attempts + 1
          FROM ready
          WHERE o.id = ready.id
        RETURNING o.id, o."queueName", o."jobName", o."jobId", o.payload, o."availableAt";
      `);

      if (claimed.length === 0) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }

      for (const ev of claimed) {
        try {
          // IL11: refuse to hand `release` jobs to BullMQ while the
          // capability is blocked (audit_compromised / emergency_freeze).
          // The outbox row stays put; we bump lockedUntil to re-check later.
          if (ev.queueName === 'release') {
            const mode = (await safety.current()).mode;
            const decision = evaluate(mode, 'release.enqueue');
            if (!decision.allow) {
              await prisma.outboxEvent.update({
                where: { id: ev.id },
                data: {
                  lockedUntil: null,
                  availableAt: new Date(Date.now() + 60_000),
                  lastError: `safety: ${decision.reason}`,
                },
              });
              continue;
            }
          }
          const delay = Math.max(0, ev.availableAt.getTime() - Date.now());
          await q(ev.queueName).add(ev.jobName, ev.payload, {
            jobId: ev.jobId,
            delay,
            removeOnComplete: { count: 1000, age: 24 * 3600 },
            removeOnFail: { count: 5000, age: 7 * 24 * 3600 },
          });
          await prisma.outboxEvent.delete({ where: { id: ev.id } });
        } catch (err) {
          const msg = (err as Error).message.slice(0, 500);
          log.warn(`relay failed for ${ev.queueName}:${ev.jobId}: ${msg}`);
          // Exponential backoff via lockedUntil + availableAt bump.
          await prisma.outboxEvent.update({
            where: { id: ev.id },
            data: {
              lockedUntil: null,
              availableAt: new Date(Date.now() + Math.min(60_000 * 2 ** Math.min(8, ev.availableAt.getTime() % 8), 600_000)),
              lastError: msg,
            },
          });
        }
      }
    } catch (err) {
      log.error(`relay tick failed: ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
