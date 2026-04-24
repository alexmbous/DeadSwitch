import { Global, Module } from '@nestjs/common';
import { KmsService } from './kms.service';
import { EnvelopeService } from './envelope.service';

@Global()
@Module({
  providers: [KmsService, EnvelopeService],
  exports: [KmsService, EnvelopeService],
})
export class CryptoModule {}
