import 'reflect-metadata';
import { Worker } from 'bullmq';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { EscalationService } from '../modules/escalation/escalation.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const escalation = app.get(EscalationService);
  const connection = { url: process.env.REDIS_URL ?? 'redis://localhost:6379' };

  const worker = new Worker(
    'escalation',
    async (job) => {
      if (job.name === 'run-step') {
        await escalation.runStep(job.data as any);
      } else if (job.name === 'grace-expiry') {
        await escalation.handleGraceExpiry((job.data as any).scenarioId);
      }
    },
    { connection, concurrency: 5 },
  );

  worker.on('failed', (job, err) => {
    // eslint-disable-next-line no-console
    console.error(`[escalation] ${job?.id} failed:`, err);
  });

  // eslint-disable-next-line no-console
  console.log('[escalation-worker] up');
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
