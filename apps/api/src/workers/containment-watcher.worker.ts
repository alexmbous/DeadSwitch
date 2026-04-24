import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { ContainmentService } from '../modules/safety/containment.service';

/**
 * Containment watcher: runs auto-detection rules every 15 seconds.
 *
 * Runs as a SINGLE replica (leader-elect via the `containment-leader` Redis
 * key with a 30s TTL). A missed tick is preferable to a double tick because
 * double-ticks can ping-pong modes.
 */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const containment = app.get(ContainmentService);
  const log = new Logger('containment-watcher');

  const TICK_MS = 15_000;

  // Simple leader lock via advisory lock + in-process heartbeat. If the lock
  // can't be acquired, we wait. Losing it causes the loop to skip ticks.
  const prismaAny: any = (app as any).get('PrismaService');
  const acquire = async () => {
    const rows: Array<{ ok: boolean }> = await prismaAny.$queryRawUnsafe(
      `SELECT pg_try_advisory_lock(42) AS ok`,
    );
    return rows[0]?.ok === true;
  };

  let haveLock = false;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      if (!haveLock) haveLock = await acquire();
      if (!haveLock) {
        await sleep(5_000);
        continue;
      }
      const res = await containment.tick();
      if (res.fired.length > 0) {
        log.warn(`tick: mode=${res.mode} fired=${res.fired.join(',')}`);
      } else {
        log.debug(`tick: mode=${res.mode}`);
      }
    } catch (err) {
      log.error(`tick failed: ${(err as Error).message}`);
      haveLock = false;
    }
    await sleep(TICK_MS);
  }
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
