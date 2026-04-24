/**
 * Idempotent dev seed. Creates (or refreshes) a single known user so you
 * can log into the API/mobile in development without going through
 * register. Safe to run repeatedly — uses upsert.
 *
 * Run:
 *   pnpm --filter @deadswitch/api prisma db seed
 *
 * Override:
 *   DEV_SEED_EMAIL=you@example.com DEV_SEED_PASSWORD=hunter2 \
 *     pnpm --filter @deadswitch/api prisma db seed
 *
 * Refuses to run with NODE_ENV=production. Argon2 params match the
 * production register path (auth.service.ts) so the resulting hash is
 * verified by the normal login flow.
 */
const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');
const crypto = require('crypto');

// Derive a stable, unique-ish E.164 phone from the email so re-seeds are
// idempotent and so two dev users with different emails don't collide on
// the unique phone constraint.
function derivePhone(email) {
  const hash = crypto.createHash('sha256').update(email).digest();
  // Use the first 4 bytes as a 32-bit unsigned int, mod 10^7 → 7 digits.
  const num = hash.readUInt32BE(0) % 10_000_000;
  return `+1555${String(num).padStart(7, '0')}`;
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed.js: refusing to run with NODE_ENV=production');
  }

  const email = process.env.DEV_SEED_EMAIL || 'dev@deadswitch.local';
  const password = process.env.DEV_SEED_PASSWORD || 'deadswitch-dev-1';
  const phoneE164 = process.env.DEV_SEED_PHONE || derivePhone(email);
  const displayName = process.env.DEV_SEED_NAME || 'Dev User';

  const prisma = new PrismaClient();
  try {
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 64 * 1024,
      timeCost: 3,
      parallelism: 1,
    });

    const cooldownPast = new Date(Date.now() - 1000);

    const user = await prisma.user.upsert({
      where: { email },
      create: {
        email,
        phoneE164,
        displayName,
        passwordHash,
        kdfVersion: 1,
        status: 'active',
        cooldownUntil: cooldownPast,
      },
      update: {
        passwordHash,
        status: 'active',
        cooldownUntil: cooldownPast,
      },
      select: { id: true, email: true, displayName: true, status: true },
    });

    console.log('\n  Dev user ready');
    console.log('  email:    ', user.email);
    console.log('  password: ', password);
    console.log('  id:       ', user.id);
    console.log('  status:   ', user.status, '\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
