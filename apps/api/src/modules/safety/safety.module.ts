import { Global, Module } from '@nestjs/common';
import { SafetyModeService } from './safety-mode.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { ContainmentService } from './containment.service';
import { RecoveryService } from './recovery.service';
import { ExitGateService } from './exit-gate.service';

@Global()
@Module({
  providers: [
    SafetyModeService,
    CircuitBreakerService,
    ContainmentService,
    RecoveryService,
    ExitGateService,
  ],
  exports: [
    SafetyModeService,
    CircuitBreakerService,
    ContainmentService,
    RecoveryService,
    ExitGateService,
  ],
})
export class SafetyModule {}
