import { Module } from '@nestjs/common';
import { EscalationService } from './escalation.service';
import { ProvidersModule } from '../providers/providers.module';

@Module({
  imports: [ProvidersModule],
  providers: [EscalationService],
  exports: [EscalationService],
})
export class EscalationModule {}
