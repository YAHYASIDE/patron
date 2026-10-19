import { Module } from '@nestjs/common';
import {
  AuditLogController, BroadcastController, CatalogToolsController, CouponsAdminController, CustomersAdminController,
  DataExportController, OrderNotesController, ShopTemplatesController,
} from './admin-tools.controller';
import { CustomersAdminService } from './customers-admin.service';
import { DataExportService } from './data-export.service';
import { CouponsAdminService } from './coupons-admin.service';
import { ShopTemplatesService } from './shop-templates.service';
import { AuditLogService } from './audit-log.service';
import { BroadcastService } from './broadcast.service';
import { CatalogToolsService } from './catalog-tools.service';

/** The owner's dashboard tools: customer page, notes, exports, backup, coupons, quick replies, log, broadcast. */
@Module({
  controllers: [
    CustomersAdminController, OrderNotesController, DataExportController, CouponsAdminController,
    ShopTemplatesController, AuditLogController, BroadcastController, CatalogToolsController,
  ],
  providers: [
    CustomersAdminService, DataExportService, CouponsAdminService, ShopTemplatesService,
    AuditLogService, BroadcastService, CatalogToolsService,
  ],
})
export class AdminToolsModule {}
