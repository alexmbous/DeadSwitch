import { Global, Module } from '@nestjs/common';
import { SessionCacheService } from './session-cache.service';

@Global()
@Module({
  providers: [SessionCacheService],
  exports: [SessionCacheService],
})
export class SessionsModule {}
