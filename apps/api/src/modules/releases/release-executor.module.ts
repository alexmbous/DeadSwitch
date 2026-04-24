import { Module } from '@nestjs/common';
import { ReleaseActionExecutor } from './release-action-executor.service';
import { ReleaseWorkerCryptoModule } from '../crypto/release-worker-crypto.module';

/**
 * Provides ReleaseActionExecutor + VaultDecryptor. Imported ONLY by the
 * release worker bootstrap and by the integration test suite. Not wired
 * into the main AppModule.
 */
@Module({
  imports: [ReleaseWorkerCryptoModule],
  providers: [ReleaseActionExecutor],
  exports: [ReleaseActionExecutor],
})
export class ReleaseExecutorModule {}
