import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { RequestGateService } from './request-gate';

@Module({
  controllers: [AdminController, DashboardController],
  providers: [AdminService, DashboardService, RequestGateService],
})
export class AdminModule {}
