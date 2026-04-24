import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReleasesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, scenarioId: string) {
    const s = await this.prisma.scenario.findFirst({ where: { id: scenarioId, userId } });
    if (!s) throw new NotFoundException();
    return this.prisma.release.findMany({
      where: { scenarioId },
      include: { actions: true },
      orderBy: { triggeredAt: 'desc' },
    });
  }

  async audit(userId: string, scenarioId: string) {
    const s = await this.prisma.scenario.findFirst({ where: { id: scenarioId, userId } });
    if (!s) throw new NotFoundException();
    return this.prisma.auditEvent.findMany({
      where: { scenarioId },
      orderBy: { occurredAt: 'asc' },
    });
  }
}
