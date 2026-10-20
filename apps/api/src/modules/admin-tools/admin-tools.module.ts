import { Module } from '@nestjs/common';
import {
  AuditLogController, BroadcastController, CatalogToolsController, CouponsAdminController, CustomersAdminController,
  DataExportController, OrderNotesController, ShopTemplatesController,
} from './admin-tools.controller';
import { BackupController } from './backup.controller';
import { CustomersAdminService } from './customers-admin.service';
import { DataExportService } from './data-export.service';
import { BackupService } from './backup.service';
import { BackupRunsService } from './backup-runs.service';
import { GoogleDriveService } from './google-drive.service';
import { CouponsAdminService } from './coupons-admin.service';
import { ShopTemplatesService } from './shop-templates.service';
import { AuditLogService } from './audit-log.service';
import { BroadcastService } from './broadcast.service';
import { CatalogToolsService } from './catalog-tools.service';

/** The owner's dashboard tools: customer page, notes, exports, backups, coupons, quick replies, log, broadcast. */
@Module({
  controllers: [
    CustomersAdminController, OrderNotesController, DataExportController, BackupController, CouponsAdminController,
    ShopTemplatesController, AuditLogController, BroadcastController, CatalogToolsController,
  ],
  providers: [
    CustomersAdminService, DataExportService, BackupService, BackupRunsService, GoogleDriveService, CouponsAdminService,
    ShopTemplatesService, AuditLogService, BroadcastService, CatalogToolsService,
  ],
  // the scheduler (QueuesModule) runs the Drive copies
  exports: [BackupRunsService],
})
export class AdminToolsModule {}
