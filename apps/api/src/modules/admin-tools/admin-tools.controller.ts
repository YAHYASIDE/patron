import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  AuditQueryDto, BroadcastDto, BulkPriceDto, CreateCouponDto, ExportOrdersQueryDto, OrderNoteDto, SegmentSettingsDto,
  UpdateCouponDto, UpdateCustomerDto, WhatsappTemplatesDto,
} from './admin-tools.dto';
import { CustomersAdminService } from './customers-admin.service';
import { DataExportService } from './data-export.service';
import { CouponsAdminService } from './coupons-admin.service';
import { ShopTemplatesService } from './shop-templates.service';
import { AuditLogService } from './audit-log.service';
import { BroadcastService } from './broadcast.service';
import { CatalogToolsService } from './catalog-tools.service';

/** Send a file download; the body is already rendered. */
function attach(res: Response, contentType: string, filename: string) {
  res.setHeader('content-type', contentType);
  res.setHeader('content-disposition', `attachment; filename="${filename}"`);
  // a customer list must not sit in a shared cache
  res.setHeader('cache-control', 'no-store');
}

@ApiBearerAuth()
@ApiTags('admin/customers')
@Controller('admin/customers')
export class CustomersAdminController {
  constructor(private customers: CustomersAdminService) {}

  @ApiOperation({ summary: 'VIP thresholds for the customer segments' })
  @RequirePermissions('users.read') @Get('segments/settings')
  segmentSettings() {
    return this.customers.segmentSettings();
  }

  @RequirePermissions('users.write') @Put('segments/settings')
  setSegmentSettings(@Body() dto: SegmentSettingsDto, @CurrentUser('id') actorId: string) {
    return this.customers.setSegmentSettings(dto, actorId);
  }

  @ApiOperation({ summary: 'A customer with stats, notes, tags and latest orders' })
  @RequirePermissions('users.read') @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.findOne(id);
  }

  @RequirePermissions('users.write') @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerDto, @CurrentUser('id') actorId: string) {
    return this.customers.update(id, dto, actorId);
  }
}

@ApiBearerAuth()
@ApiTags('admin/orders')
@Controller('admin/orders')
export class OrderNotesController {
  constructor(private customers: CustomersAdminService) {}

  @ApiOperation({ summary: 'Set or clear the staff note on an order' })
  @RequirePermissions('orders.fulfil_manual') @Patch(':id/note')
  setNote(@Param('id', ParseUUIDPipe) id: string, @Body() dto: OrderNoteDto, @CurrentUser('id') actorId: string) {
    return this.customers.setOrderNote(id, dto, actorId);
  }
}

@ApiBearerAuth()
@ApiTags('admin/export')
// whole-table reads: a few per minute is plenty
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Controller('admin')
export class DataExportController {
  constructor(private exporter: DataExportService) {}

  @ApiOperation({ summary: 'Orders as CSV (UTF-8 with BOM)' })
  @RequirePermissions('reports.read') @Get('export/orders.csv')
  async orders(@Query() query: ExportOrdersQueryDto, @Res({ passthrough: true }) res: Response) {
    const { filename, csv } = await this.exporter.ordersCsv(query.from, query.to);
    attach(res, 'text/csv; charset=utf-8', filename);
    return csv;
  }

  @ApiOperation({ summary: 'Customers as CSV (UTF-8 with BOM)' })
  @RequirePermissions('users.read') @Get('export/customers.csv')
  async customers(@Res({ passthrough: true }) res: Response) {
    const { filename, csv } = await this.exporter.customersCsv();
    attach(res, 'text/csv; charset=utf-8', filename);
    return csv;
  }

  /** When the last full backup was downloaded, so the dashboard can remind the owner. */
  @RequirePermissions('settings.manage') @Get('backup/status')
  async backupStatus() {
    return { lastBackupAt: await this.exporter.lastBackupAt() };
  }

  @ApiOperation({
    summary: 'Full backup as a JSON download',
    description:
      'Everything the shop is rebuilt from (dist/restore-runner.js): customers, wallets and their ledger, orders, payments, ' +
      'refunds, the catalogue and the code stock (encrypted as stored). No password hashes, sessions, 2FA secrets, ' +
      'sensitive inputs, provider keys or uploaded files.',
  })
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @RequirePermissions('settings.manage') @Get('backup')
  async backup(@Res({ passthrough: true }) res: Response) {
    const { filename, body } = await this.exporter.backup();
    attach(res, 'application/json; charset=utf-8', filename);
    return body;
  }
}

@ApiBearerAuth()
@ApiTags('admin/coupons')
@Controller('admin/coupons')
export class CouponsAdminController {
  constructor(private coupons: CouponsAdminService) {}

  @RequirePermissions('coupons.manage') @Get()
  list() {
    return this.coupons.list();
  }

  @RequirePermissions('coupons.manage') @Post()
  create(@Body() dto: CreateCouponDto, @CurrentUser('id') actorId: string) {
    return this.coupons.create(dto, actorId);
  }

  @RequirePermissions('coupons.manage') @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCouponDto, @CurrentUser('id') actorId: string) {
    return this.coupons.update(id, dto, actorId);
  }
}

@ApiBearerAuth()
@ApiTags('admin/shop')
@Controller('admin/shop')
export class ShopTemplatesController {
  constructor(private templates: ShopTemplatesService) {}

  @ApiOperation({ summary: 'WhatsApp quick replies for the order page' })
  @RequirePermissions('settings.manage') @Get('templates')
  list() {
    return this.templates.list();
  }

  @RequirePermissions('settings.manage') @Put('templates')
  replace(@Body() dto: WhatsappTemplatesDto, @CurrentUser('id') actorId: string) {
    return this.templates.replace(dto.templates, actorId);
  }
}

@ApiBearerAuth()
@ApiTags('admin/audit')
@Controller('admin/audit')
export class AuditLogController {
  constructor(private auditLog: AuditLogService) {}

  @ApiOperation({ summary: 'Activity log: who changed what (cursor pagination)' })
  @RequirePermissions('audit.read') @Get()
  list(@Query() query: AuditQueryDto) {
    return this.auditLog.list(query);
  }
}

@ApiBearerAuth()
@ApiTags('admin/notifications')
@Controller('admin/notifications')
export class BroadcastController {
  constructor(private broadcast: BroadcastService) {}

  @ApiOperation({ summary: 'Send an in-app message to every active customer (optionally one country)' })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @RequirePermissions('notifications.send') @HttpCode(200) @Post('broadcast')
  send(@Body() dto: BroadcastDto, @CurrentUser('id') actorId: string) {
    return this.broadcast.send(dto, actorId);
  }
}

/** Shares the `admin/catalog/products` prefix with CatalogAdminController; these paths are its own. */
@ApiBearerAuth()
@ApiTags('admin/catalog')
@Controller('admin/catalog/products')
export class CatalogToolsController {
  constructor(private tools: CatalogToolsService) {}

  @ApiOperation({ summary: 'Raise or lower base prices by a percentage, with a dry-run preview' })
  @RequirePermissions('catalog.pricing') @HttpCode(200) @Post('bulk-price')
  bulkPrice(@Body() dto: BulkPriceDto, @CurrentUser('id') actorId: string) {
    return this.tools.bulkPrice(dto, actorId);
  }

  @ApiOperation({ summary: 'Duplicate a product (inactive copy, no codes)' })
  @RequirePermissions('catalog.write') @Post(':id/clone')
  clone(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') actorId: string) {
    return this.tools.clone(id, actorId);
  }
}
