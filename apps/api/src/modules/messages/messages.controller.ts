import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MessagesService } from './messages.service';

class IngestMessageDto {
  @IsOptional() @IsString() recipientId?: string;
  @IsEnum(['email', 'sms', 'social']) channel!: 'email' | 'sms' | 'social';
  @IsOptional() @IsString() @MaxLength(200) subject?: string;
  @IsString() @MaxLength(20_000) plaintext!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('bundles/:bundleId/messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Post()
  ingest(
    @CurrentUser() user: { userId: string },
    @Param('bundleId') bundleId: string,
    @Body() dto: IngestMessageDto,
  ) {
    return this.messages.ingest(user.userId, bundleId, dto);
  }
}
