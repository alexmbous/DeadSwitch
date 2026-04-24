import { z } from 'zod';

const base = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  RECIPIENT_TOKEN_HMAC_KEY: z.string().min(32).optional(),
  JWT_ACCESS_TTL: z.coerce.number().default(900),
  JWT_REFRESH_TTL: z.coerce.number().default(2_592_000),

  KMS_MODE: z.enum(['mock', 'aws']).default('mock'),
  KMS_MOCK_MASTER_KEY_BASE64: z.string().optional(),
  AWS_KMS_ACTION_KEY_ENCRYPT_ARN: z.string().optional(),
  AWS_KMS_ACTION_KEY_DECRYPT_ARN: z.string().optional(),
  AWS_REGION: z.string().optional(),

  // Role the process is running as. API pods must NEVER have "release-worker".
  PROCESS_ROLE: z.enum(['api', 'release-worker', 'checkins-worker', 'escalation-worker']).default('api'),

  SENDGRID_API_KEY: z.string().optional(),
  SENDGRID_FROM: z.string().optional(),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  TWILIO_VOICE_CALLBACK_URL: z.string().optional(),

  ACCOUNT_COOLDOWN_SECONDS: z.coerce.number().default(259_200),
  MAX_SCENARIOS_PER_USER: z.coerce.number().default(5),
  MAX_BUNDLES_PER_SCENARIO: z.coerce.number().default(10),
  MAX_RECIPIENTS_PER_BUNDLE: z.coerce.number().default(25),
  MIN_GRACE_PERIOD_SECONDS: z.coerce.number().default(21_600),

  // Attachment release pipeline.
  BLOB_STORAGE_PATH: z.string().optional(),
  MAX_ATTACHMENT_BYTES: z.coerce.number().default(10 * 1024 * 1024),
  PUBLIC_BASE_URL: z.string().url().optional(),
  ATTACHMENT_LINK_TTL_SECONDS: z.coerce.number().default(7 * 24 * 3600),
  ATTACHMENT_LINK_MAX_USES: z.coerce.number().default(5),
});

export const envSchema = base.superRefine((cfg, ctx) => {
  const nonDev = cfg.NODE_ENV === 'staging' || cfg.NODE_ENV === 'production';

  const prod = cfg.NODE_ENV === 'production';

  // --- KMS must be real outside of dev/test ---
  if (nonDev && cfg.KMS_MODE !== 'aws') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `KMS_MODE=mock is forbidden when NODE_ENV=${cfg.NODE_ENV}. Configure AWS KMS.`,
      path: ['KMS_MODE'],
    });
  }

  // --- Production-only additional refusal rules (PART 9) ---
  if (prod) {
    // Release worker must not share a PROCESS_ROLE with a non-release role.
    if (cfg.AWS_KMS_ACTION_KEY_DECRYPT_ARN && cfg.PROCESS_ROLE !== 'release-worker') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `PROCESS_ROLE=${cfg.PROCESS_ROLE} must not hold AWS_KMS_ACTION_KEY_DECRYPT_ARN`,
        path: ['PROCESS_ROLE'],
      });
    }
    // Provider credentials must be complete if present at all.
    const twilioParts = [cfg.TWILIO_ACCOUNT_SID, cfg.TWILIO_AUTH_TOKEN, cfg.TWILIO_FROM_NUMBER];
    const twilioFilled = twilioParts.filter(Boolean).length;
    if (twilioFilled > 0 && twilioFilled < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Twilio partially configured (${twilioFilled}/3)`,
        path: ['TWILIO_ACCOUNT_SID'],
      });
    }
    if (cfg.SENDGRID_API_KEY && !cfg.SENDGRID_FROM) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SENDGRID_API_KEY set but SENDGRID_FROM missing',
        path: ['SENDGRID_FROM'],
      });
    }
    // Minimum cooldown and grace in production.
    if (cfg.ACCOUNT_COOLDOWN_SECONDS < 3600) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ACCOUNT_COOLDOWN_SECONDS too short for production (>=3600)',
        path: ['ACCOUNT_COOLDOWN_SECONDS'],
      });
    }
    if (cfg.MIN_GRACE_PERIOD_SECONDS < 21_600) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'MIN_GRACE_PERIOD_SECONDS too short for production (>=21600)',
        path: ['MIN_GRACE_PERIOD_SECONDS'],
      });
    }
    if (!cfg.RECIPIENT_TOKEN_HMAC_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'RECIPIENT_TOKEN_HMAC_KEY required in production',
        path: ['RECIPIENT_TOKEN_HMAC_KEY'],
      });
    }
  }

  if (cfg.KMS_MODE === 'aws') {
    if (!cfg.AWS_REGION) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'AWS_REGION required', path: ['AWS_REGION'] });
    }
    // The API role must NOT have decrypt; the release worker must NOT have encrypt.
    if (cfg.PROCESS_ROLE === 'api' || cfg.PROCESS_ROLE === 'checkins-worker' || cfg.PROCESS_ROLE === 'escalation-worker') {
      if (!cfg.AWS_KMS_ACTION_KEY_ENCRYPT_ARN) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${cfg.PROCESS_ROLE} requires AWS_KMS_ACTION_KEY_ENCRYPT_ARN`, path: ['AWS_KMS_ACTION_KEY_ENCRYPT_ARN'] });
      }
      if (cfg.AWS_KMS_ACTION_KEY_DECRYPT_ARN) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${cfg.PROCESS_ROLE} MUST NOT be given AWS_KMS_ACTION_KEY_DECRYPT_ARN`, path: ['AWS_KMS_ACTION_KEY_DECRYPT_ARN'] });
      }
    }
    if (cfg.PROCESS_ROLE === 'release-worker') {
      if (!cfg.AWS_KMS_ACTION_KEY_DECRYPT_ARN) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'release-worker requires AWS_KMS_ACTION_KEY_DECRYPT_ARN', path: ['AWS_KMS_ACTION_KEY_DECRYPT_ARN'] });
      }
    }
  }

  // --- Never allow mock JWT secrets outside dev/test ---
  if (nonDev) {
    const weak = ['change-me-access', 'change-me-refresh'];
    if (weak.includes(cfg.JWT_ACCESS_SECRET) || weak.includes(cfg.JWT_REFRESH_SECRET)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'JWT secrets are placeholder values', path: ['JWT_ACCESS_SECRET'] });
    }
    if (!cfg.RECIPIENT_TOKEN_HMAC_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'RECIPIENT_TOKEN_HMAC_KEY is required outside dev/test',
        path: ['RECIPIENT_TOKEN_HMAC_KEY'],
      });
    }
  }
});

export type Env = z.infer<typeof base>;
