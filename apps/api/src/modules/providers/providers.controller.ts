import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { ProvidersService } from './providers.service';
import { ProviderEngine } from './provider-engine.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiBearerAuth()
@ApiTags('admin/providers')
@Controller('admin/providers')
export class ProvidersController {
  constructor(private providers: ProvidersService, private engine: ProviderEngine) {}

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

  /** Operator retry, optionally pinned to a specific provider. */
  @RequirePermissions('orders.retry') @HttpCode(200) @Post('fulfil/:orderItemId')
  retry(@Param('orderItemId') orderItemId: string, @Body('providerId') providerId?: string) {
    return this.engine.fulfilItem(orderItemId, providerId);
  }
}
