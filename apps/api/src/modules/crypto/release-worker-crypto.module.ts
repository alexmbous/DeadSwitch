import { Module } from '@nestjs/common';
import { VaultDecryptor } from './vault-decryptor';
import { AttachmentReleaseIssuer } from '../attachments/attachment-release-issuer.service';

/**
 * Imported ONLY by the release worker bootstrap. Never imported from the
 * main AppModule.
 *
 * This means: even if a future developer adds a bug that calls
 * VaultDecryptor or AttachmentReleaseIssuer from API code, Nest DI will
 * fail to resolve them. The constructor-level PROCESS_ROLE check on each
 * is a second barrier.
 */
@Module({
  providers: [VaultDecryptor, AttachmentReleaseIssuer],
  exports: [VaultDecryptor, AttachmentReleaseIssuer],
})
export class ReleaseWorkerCryptoModule {}
