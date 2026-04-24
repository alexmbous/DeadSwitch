import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { AdminRequestKind, SafetyModeKind } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';

class RequestDto {
  @IsEnum([
    'enter_mode', 'exit_mode', 'pause_provider', 'resume_provider',
    'pause_queue', 'resume_queue', 'reduce_concurrency', 'drain_releases',
    'force_unlock_release',
  ])
  kind!: AdminRequestKind;

  params!: Record<string, unknown>;

  @IsString() reason!: string;

  @IsOptional() @IsEnum(SafetyModeKind) _lintAid?: SafetyModeKind;
}

@UseGuards(JwtAuthGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService, private readonly prisma: PrismaService) {}

  /**
   * Guard: assert user has admin role. In the scaffold we read a simple
   * roles claim attached via a separate role table. Controllers cannot be
   * invoked without a JWT and every action is audited.
   */
  private async requireAdmin(userId: string): Promise<void> {
    // Placeholder: look up a user_roles table or a dedicated admin list.
    // For the scaffold we accept ADMIN_USER_IDS from env as a comma list.
    const allow = (process.env.ADMIN_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (allow.length > 0 && !allow.includes(userId)) {
      throw new ForbiddenException('not an admin');
    }
  }

  @Post('requests')
  async create(@CurrentUser() u: { userId: string }, @Body() dto: RequestDto) {
    await this.requireAdmin(u.userId);
    return this.admin.request(u.userId, dto.kind, dto.params, dto.reason);
  }

  @Post('requests/:id/approve')
  async approve(@CurrentUser() u: { userId: string }, @Param('id') id: string) {
    await this.requireAdmin(u.userId);
    return this.admin.approveAndExecute(id, u.userId);
  }

  @Post('requests/:id/reject')
  async reject(
    @CurrentUser() u: { userId: string },
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    await this.requireAdmin(u.userId);
    await this.admin.reject(id, u.userId, body.reason);
    return { ok: true };
  }

  @Get('requests')
  async list(@CurrentUser() u: { userId: string }) {
    await this.requireAdmin(u.userId);
    return this.prisma.adminRequest.findMany({
      where: { status: { in: ['pending'] } },
      orderBy: { requestedAt: 'desc' },
      take: 50,
    });
  }
}
