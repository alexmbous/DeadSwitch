import { Global, Module } from '@nestjs/common';
import { StateMachineService } from './state.service';

@Global()
@Module({
  providers: [StateMachineService],
  exports: [StateMachineService],
})
export class StateMachineModule {}
