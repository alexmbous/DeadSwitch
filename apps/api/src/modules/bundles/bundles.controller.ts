import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BundlesService } from './bundles.service';

class CreateBundleDto {
  @IsString() title!: string;
  @IsOptional() @IsEnum(['on_release', 'on_incident_open']) releaseStage?:
    | 'on_release'
    | 'on_incident_open';
  @IsOptional() @IsEnum(['private', 'public']) visibility?: 'private' | 'public';
}

class AddRecipientDto {
  @IsEnum(['email', 'sms', 'secure_link', 'social_handle']) recipientKind!:
    | 'email'
    | 'sms'
    | 'secure_link'
    | 'social_handle';
  @IsString() address!: string;
  @IsOptional() @IsString() displayName?: string;
  @IsOptional() @IsEnum(['direct', 'secure_link']) accessMethod?: 'direct' | 'secure_link';
}

@UseGuards(JwtAuthGuard)
@Controller()
export class BundlesController {
  constructor(private readonly bundles: BundlesService) {}

  @Get('scenarios/:scenarioId/bundles')
  list(@CurrentUser() user: { userId: string }, @Param('scenarioId') scenarioId: string) {
    return this.bundles.list(user.userId, scenarioId);
  }

  @Post('scenarios/:scenarioId/bundles')
  create(
    @CurrentUser() user: { userId: string },
    @Param('scenarioId') scenarioId: string,
    @Body() dto: CreateBundleDto,
  ) {
    return this.bundles.create(user.userId, scenarioId, dto);
  }

  @Post('bundles/:bundleId/recipients')
  addRecipient(
    @CurrentUser() user: { userId: string },
    @Param('bundleId') bundleId: string,
    @Body() dto: AddRecipientDto,
  ) {
    return this.bundles.addRecipient(user.userId, bundleId, dto);
  }
}
