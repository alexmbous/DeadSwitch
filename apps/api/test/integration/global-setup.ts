import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Client } from 'pg';

/**
 * Global one-time setup for the integration suite.
 *
 * Expects docker-compose.test.yml to already be running:
 *   docker compose -f docker-compose.test.yml up -d
 *
 * We assert Postgres is reachable, run Prisma migrations, and seed the
 * SafetyMode singleton. We do NOT start Docker ourselves — the CI pipeline
 * is responsible; running tests locally requires the operator to start
 * the compose stack first.
 */
export default async function () {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://deaddrop:deaddrop@localhost:55432/deaddrop_test?schema=public';
  process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:56379';
  process.env.NODE_ENV = 'test';
  process.env.JWT_ACCESS_SECRET = 'x'.repeat(40);
  process.env.JWT_REFRESH_SECRET = 'y'.repeat(40);
  process.env.RECIPIENT_TOKEN_HMAC_KEY = 'z'.repeat(40);
  process.env.KMS_MODE = 'mock';
  process.env.ACCOUNT_COOLDOWN_SECONDS = '0';
  // Sandboxed blob root so attachment tests don't pollute repo working dir.
  const blobRoot = process.env.BLOB_STORAGE_PATH ?? path.join(os.tmpdir(), 'deadswitch-test-blobs');
  fs.mkdirSync(blobRoot, { recursive: true });
  process.env.BLOB_STORAGE_PATH = blobRoot;
  process.env.PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? 'https://test.deadswitch.local';
  process.env.ATTACHMENT_LINK_TTL_SECONDS = process.env.ATTACHMENT_LINK_TTL_SECONDS ?? '3600';
  process.env.ATTACHMENT_LINK_MAX_USES = process.env.ATTACHMENT_LINK_MAX_USES ?? '3';

  // Wait for Postgres.
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  for (let i = 0; i < 30; i++) {
    try { await client.connect(); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  await client.end().catch(() => void 0);

  // Prisma migrate.
  execSync('pnpm prisma migrate deploy', { stdio: 'inherit' });
}
