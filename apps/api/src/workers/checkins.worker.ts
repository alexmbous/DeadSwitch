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
    'checkins',
    async (job) => {
      if (job.name === 'due') {
        const { scenarioId, dueAtIso } = job.data as { scenarioId: string; dueAtIso: string };
        await escalation.handleCheckinDue(scenarioId, dueAtIso);
      }
    },
    { connection, concurrency: 10 },
  );

  worker.on('failed', (job, err) => {
    // eslint-disable-next-line no-console
    console.error(`[checkins] ${job?.id} failed:`, err);
  });

  // eslint-disable-next-line no-console
  console.log('[checkins-worker] up');
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
