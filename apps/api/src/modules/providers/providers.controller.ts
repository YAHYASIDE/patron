import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { ProvidersService } from './providers.service';
import { ProviderEngine } from './provider-engine.service';
import { ProviderSetupService } from './provider-setup.service';
import {
  AutoDeliveryDto, CatalogQueryDto, ConnectProviderDto, LinkProductDto, ProviderLimitsDto,
} from './dto/provider-setup.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiBearerAuth()
@ApiTags('admin/providers')
@Controller('admin/providers')
export class ProvidersController {
  constructor(
    private providers: ProvidersService,
    private engine: ProviderEngine,
    private setup: ProviderSetupService,
  ) {}

  @RequirePermissions('providers.read') @Get()
  findAll() {
    return this.providers.findAll();
  }

  @RequirePermissions('providers.read') @HttpCode(200) @Post('health-check')
  healthCheck() {
    return this.providers.runHealthChecks();
  }

  @RequirePermissions('providers.rotate_key') @HttpCode(200) @Post(':id/rotate-key')
  rotateKey(
    @Param('id') id: string,
    @Body('apiKey') apiKey: string,
    @Body('apiSecret') apiSecret: string | undefined,
    @CurrentUser('id') actorId: string,
  ) {
    return this.providers.rotateKey(id, apiKey, apiSecret, actorId);
  }

  // ─── Owner setup (dashboard «المورّدون») ───

  /** Connect (or re-key) a supplier account. The token is stored encrypted and never returned. */
  @RequirePermissions('providers.rotate_key') @HttpCode(200) @Post('connect')
  connect(@Body() dto: ConnectProviderDto, @CurrentUser('id') actorId: string) {
    return this.setup.connect(dto, actorId);
  }

  @RequirePermissions('providers.read') @Get(':id/status')
  status(@Param('id', ParseUUIDPipe) id: string) {
    return this.setup.status(id);
  }

  @RequirePermissions('providers.write') @Patch(':id/limits')
  limits(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ProviderLimitsDto, @CurrentUser('id') actorId: string) {
    return this.setup.setLimits(id, dto, actorId);
  }

  /** Read-only search of the supplier's catalog. */
  @RequirePermissions('providers.read') @Get(':id/catalog')
  catalog(@Param('id', ParseUUIDPipe) id: string, @Query() q: CatalogQueryDto) {
    return this.setup.catalog(id, q);
  }

  @RequirePermissions('providers.read') @Get(':id/links')
  links(@Param('id', ParseUUIDPipe) id: string) {
    return this.setup.links(id);
  }

  @RequirePermissions('providers.write') @Post(':id/links')
  link(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkProductDto, @CurrentUser('id') actorId: string) {
    return this.setup.link(id, dto, actorId);
  }

  @RequirePermissions('providers.write') @Delete('links/:linkId')
  unlink(@Param('linkId', ParseUUIDPipe) linkId: string, @CurrentUser('id') actorId: string) {
    return this.setup.unlink(linkId, actorId);
  }

  /** Automatic delivery for one linked product (off by default). */
  @RequirePermissions('providers.write') @HttpCode(200) @Post('links/:linkId/auto')
  auto(@Param('linkId', ParseUUIDPipe) linkId: string, @Body() dto: AutoDeliveryDto, @CurrentUser('id') actorId: string) {
    return this.setup.setAuto(linkId, dto.enabled, actorId);
  }

  /** The supplier's documented test purchase (GamesDrop offer 999): no real stock, no real money. */
  @RequirePermissions('providers.write') @HttpCode(200) @Post(':id/test-order')
  testOrder(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') actorId: string) {
    return this.setup.testOrder(id, actorId);
  }

  /** Operator retry, optionally pinned to a specific provider. */
  @RequirePermissions('orders.retry') @HttpCode(200) @Post('fulfil/:orderItemId')
  retry(@Param('orderItemId') orderItemId: string, @Body('providerId') providerId?: string) {
    return this.engine.fulfilItem(orderItemId, providerId);
  }
}
