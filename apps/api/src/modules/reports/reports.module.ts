import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { AnalyticsService } from './analytics.service';
import { ReportExportService } from './report-export.service';
import { RollupService } from '../maintenance/rollup.service';
import { QUEUES } from '../queues/queue.constants';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUES.FULFILMENT },
      { name: QUEUES.NOTIFICATIONS },
      { name: QUEUES.MAINTENANCE },
    ),
  ],
  controllers: [ReportsController],
  providers: [ReportsService, AnalyticsService, ReportExportService, RollupService],
  exports: [ReportsService, AnalyticsService, RollupService],
})
export class ReportsModule {}
