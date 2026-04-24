import 'reflect-metadata';
import { Worker, Job } from 'bullmq';
import { NestFactory } from '@nestjs/core';
import { Logger, Module } from '@nestjs/common';
import { AppModule } from '../app.module';
import { ReleaseActionExecutor } from '../modules/releases/release-action-executor.service';
import { ReleaseExecutorModule } from '../modules/releases/release-executor.module';

/**
 * RELEASE WORKER ENTRY POINT.
 *
 * Delegates per-action work to ReleaseActionExecutor (the same service the
 * integration suite calls). All chokepoints — VaultDecryptor, ProviderAdapter,
 * AttachmentReleaseIssuer, StateMachineService, SafetyModeService — live
 * inside that service. Keeping the worker entry thin prevents the inline
 * implementation from drifting from the tested service.
 */
@Module({ imports: [AppModule, ReleaseExecutorModule] })
class ReleaseWorkerModule {}

const RELEASE_BATCH_SIZE = Number(process.env.RELEASE_BATCH_SIZE ?? 3);

async function main() {
  if (process.env.PROCESS_ROLE !== 'release-worker') {
    throw new Error(
      `release.worker.ts must run with PROCESS_ROLE=release-worker (got ${process.env.PROCESS_ROLE})`,
    );
  }

  const app = await NestFactory.createApplicationContext(ReleaseWorkerModule);
  const executor = app.get(ReleaseActionExecutor);
  const log = new Logger('release-worker');
  const connection = { url: process.env.REDIS_URL ?? 'redis://localhost:6379' };

  const worker = new Worker(
    'release',
    async (job: Job) => {
      if (job.name !== 'execute') return;
      const { actionId } = job.data as { actionId: string };
      await executor.run(actionId, job.attemptsMade + 1);
    },
    {
      connection,
      concurrency: RELEASE_BATCH_SIZE,
      settings: { backoffStrategy: (a) => Math.min(300_000, 30_000 * 2 ** (a - 1)) },
    },
  );

  worker.on('failed', (job, err) => {
    log.error(`[release] ${job?.id} failed: ${(err as Error).message}`);
  });

  log.log(`[release-worker] up (concurrency=${RELEASE_BATCH_SIZE})`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
