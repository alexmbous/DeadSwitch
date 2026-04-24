import type { Config } from 'jest';

const config: Config = {
  displayName: 'integration',
  rootDir: '.',
  testMatch: ['<rootDir>/test/integration/**/*.e2e-spec.ts'],
  preset: 'ts-jest',
  testEnvironment: 'node',
  globalSetup: '<rootDir>/test/integration/global-setup.ts',
  globalTeardown: '<rootDir>/test/integration/global-teardown.ts',
  setupFilesAfterEach: ['<rootDir>/test/integration/per-test.ts'],
  // Important: serial. Integration tests share Postgres+Redis; parallelism
  // would require per-worker schemas. Keep it simple and deterministic.
  maxWorkers: 1,
  testTimeout: 30_000,
  clearMocks: true,
  restoreMocks: true,
  moduleNameMapper: {
    '^@deadswitch/shared$': '<rootDir>/../../packages/shared/src',
  },
};

export default config;
