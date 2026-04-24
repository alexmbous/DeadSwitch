import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient | PrismaService;

export interface EnqueueSpec {
  queue: 'checkins' | 'escalation' | 'release' | 'audit-export';
  jobName: string;
  jobId: string;                 // deterministic
  payload: Record<string, unknown>;
  delayMs?: number;
}

/**
 * Transactional outbox — every queue job originating from the API or workers
 * goes through here. Callers MUST pass the same Prisma transaction that
 * made the state change; if the tx rolls back, the enqueue is rolled back
 * too.
 *
 * The relay worker (workers/outbox-relay.worker.ts) is the only process that
 * calls BullMQ.add(). It uses the outbox row's deterministic jobId so
 * duplicate handoffs are no-ops.
 */
@Injectable()
export class OutboxService {
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(tx: Tx, spec: EnqueueSpec): Promise<void> {
    const availableAt = spec.delayMs
      ? new Date(Date.now() + spec.delayMs)
      : new Date();

    // `ON CONFLICT DO NOTHING` semantics via Prisma: we want re-enqueue by
    // the same deterministic jobId to be an idempotent no-op (e.g. the
    // reconciler sentinel re-asserting the expected set of jobs).
    await (tx as PrismaService).outboxEvent
      .create({
        data: {
          queueName: spec.queue,
          jobName: spec.jobName,
          jobId: spec.jobId,
          payload: spec.payload as Prisma.InputJsonValue,
          availableAt,
        },
      })
      .catch((err: any) => {
        if (err?.code !== 'P2002') throw err; // unique violation = duplicate, safe to ignore
      });
  }
}
