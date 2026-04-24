import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { RecipientsService } from './recipients.service';

class UnlockDto {
  @IsOptional() @IsString() accessCode?: string;
}

/**
 * Public recipient-facing endpoints. No JWT — bearer auth is the one-time
 * token embedded in the URL, combined with the optional out-of-band PIN.
 *
 * Rate-limited aggressively to prevent token enumeration / PIN brute force.
 */
@Controller('r')
export class RecipientsController {
  constructor(private readonly recipients: RecipientsService) {}

  @Throttle({ medium: { limit: 30, ttl: 60_000 } })
  @Get(':token')
  describe(@Param('token') token: string) {
    return this.recipients.describe(token);
  }

  @Throttle({ medium: { limit: 6, ttl: 900_000 } }) // 6 tries / 15 min per token
  @Post(':token/unlock')
  unlock(@Param('token') token: string, @Body() dto: UnlockDto) {
    return this.recipients.unlock(token, dto.accessCode);
  }
}
