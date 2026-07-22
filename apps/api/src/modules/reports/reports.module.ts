import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { AnalyticsService } from './analytics.service';
import { ReportExportService } from './report-export.service';
import { MaintenanceModule } from '../maintenance/maintenance.module';
import { QUEUES } from '../queues/queue.constants';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUES.FULFILMENT },
      { name: QUEUES.NOTIFICATIONS },
      { name: QUEUES.MAINTENANCE },
    ),
    // RollupService is owned and exported by MaintenanceModule; import it here
    // rather than re-registering a second, divergent instance.
    MaintenanceModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService, AnalyticsService, ReportExportService],
  exports: [ReportsService, AnalyticsService],
})
export class ReportsModule {}
