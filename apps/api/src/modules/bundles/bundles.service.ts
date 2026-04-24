import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BundlesService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async list(userId: string, scenarioId: string) {
    await this.requireScenario(userId, scenarioId);
    return this.prisma.releaseBundle.findMany({
      where: { scenarioId },
      include: { recipients: true },
    });
  }

  async create(userId: string, scenarioId: string, data: {
    title: string;
    releaseStage?: 'on_release' | 'on_incident_open';
    visibility?: 'private' | 'public';
  }) {
    await this.requireScenario(userId, scenarioId);
    const max = this.config.get<number>('MAX_BUNDLES_PER_SCENARIO') ?? 10;
    const count = await this.prisma.releaseBundle.count({ where: { scenarioId } });
    if (count >= max) throw new ForbiddenException('bundle limit reached');

    return this.prisma.releaseBundle.create({
      data: {
        scenarioId,
        title: data.title,
        releaseStage: data.releaseStage ?? 'on_release',
        visibility: data.visibility ?? 'private',
      },
    });
  }

  async addRecipient(userId: string, bundleId: string, data: {
    recipientKind: 'email' | 'sms' | 'secure_link' | 'social_handle';
    address: string;
    displayName?: string;
    accessMethod?: 'direct' | 'secure_link';
  }) {
    const bundle = await this.requireBundle(userId, bundleId);
    const max = this.config.get<number>('MAX_RECIPIENTS_PER_BUNDLE') ?? 25;
    const count = await this.prisma.bundleRecipient.count({ where: { bundleId } });
    if (count >= max) throw new ForbiddenException('recipient limit reached');
    return this.prisma.bundleRecipient.create({
      data: {
        bundleId: bundle.id,
        recipientKind: data.recipientKind,
        address: data.address,
        displayName: data.displayName,
        accessMethod: data.accessMethod ?? 'direct',
      },
    });
  }

  private async requireScenario(userId: string, scenarioId: string) {
    const s = await this.prisma.scenario.findFirst({ where: { id: scenarioId, userId } });
    if (!s) throw new NotFoundException('scenario not found');
    return s;
  }

  async requireBundle(userId: string, bundleId: string) {
    const b = await this.prisma.releaseBundle.findUnique({
      where: { id: bundleId },
      include: { scenario: true },
    });
    if (!b || b.scenario.userId !== userId) throw new NotFoundException('bundle not found');
    return b;
  }
}
