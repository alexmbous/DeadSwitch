import { Module } from '@nestjs/common';
import { VaultController } from './vault.controller';
import { VaultService } from './vault.service';
import { BundlesModule } from '../bundles/bundles.module';

@Module({
  imports: [BundlesModule],
  controllers: [VaultController],
  providers: [VaultService],
})
export class VaultModule {}
