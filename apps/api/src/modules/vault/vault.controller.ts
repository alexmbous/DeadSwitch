import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { IsBase64, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { VaultService } from './vault.service';

class VaultUploadDto {
  @IsString() ciphertextBlobRef!: string;
  @IsBase64() wrappedDek!: string;
  @IsString() clientKeyId!: string;
  @IsBase64() nonce!: string;
  @IsOptional() @IsString() expiresAt?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('bundles/:bundleId/vault-items')
export class VaultController {
  constructor(private readonly vault: VaultService) {}

  @Post()
  upload(
    @CurrentUser() user: { userId: string },
    @Param('bundleId') bundleId: string,
    @Body() dto: VaultUploadDto,
  ) {
    return this.vault.upload(user.userId, bundleId, dto);
  }
}
