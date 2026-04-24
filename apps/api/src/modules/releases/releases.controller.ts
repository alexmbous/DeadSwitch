import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReleasesService } from './releases.service';

@UseGuards(JwtAuthGuard)
@Controller('scenarios/:scenarioId')
export class ReleasesController {
  constructor(private readonly releases: ReleasesService) {}

  @Get('releases')
  list(@CurrentUser() user: { userId: string }, @Param('scenarioId') scenarioId: string) {
    return this.releases.list(user.userId, scenarioId);
  }

  @Get('audit')
  audit(@CurrentUser() user: { userId: string }, @Param('scenarioId') scenarioId: string) {
    return this.releases.audit(user.userId, scenarioId);
  }
}
