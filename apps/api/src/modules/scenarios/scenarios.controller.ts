import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ScenariosService } from './scenarios.service';

class CreateScenarioDto {
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsInt() @Min(60 * 15) checkinIntervalSeconds!: number;
  @IsInt() @Min(60 * 60) gracePeriodSeconds!: number;
  @IsOptional() @IsInt() @Min(60) expectedDurationSeconds?: number;
  @IsOptional() @IsString() autoExpireAt?: string;
}

class ArmDto {
  @IsString() password!: string;
  @IsString() biometricReceipt!: string;
}

class AbortDto {
  @IsString() abortCode!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('scenarios')
export class ScenariosController {
  constructor(private readonly scenarios: ScenariosService) {}

  @Get()
  list(@CurrentUser() user: { userId: string }) {
    return this.scenarios.list(user.userId);
  }

  @Post()
  create(@CurrentUser() user: { userId: string }, @Body() dto: CreateScenarioDto) {
    return this.scenarios.create(user.userId, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: { userId: string }, @Param('id') id: string) {
    return this.scenarios.get(user.userId, id);
  }

  @Post(':id/arm')
  arm(@CurrentUser() user: { userId: string }, @Param('id') id: string, @Body() dto: ArmDto) {
    return this.scenarios.arm(user.userId, id, dto.password);
  }

  @Post(':id/disarm')
  disarm(@CurrentUser() user: { userId: string }, @Param('id') id: string, @Body() dto: ArmDto) {
    return this.scenarios.disarm(user.userId, id, dto.password);
  }

  @Post(':id/checkin')
  checkin(@CurrentUser() user: { userId: string }, @Param('id') id: string) {
    return this.scenarios.performCheckin(user.userId, id);
  }

  @Post(':id/abort')
  abort(@CurrentUser() user: { userId: string }, @Param('id') id: string, @Body() dto: AbortDto) {
    return this.scenarios.abort(user.userId, id, dto.abortCode);
  }

  @Delete(':id')
  deleteDraft(@CurrentUser() user: { userId: string }, @Param('id') id: string) {
    return this.scenarios.deleteDraft(user.userId, id);
  }
}
