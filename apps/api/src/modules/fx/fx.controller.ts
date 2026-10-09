import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { FxService } from './fx.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiBearerAuth()
@ApiTags('admin/fx')
@Controller('admin/fx')
export class FxController {
  constructor(private fx: FxService) {}

  @RequirePermissions('settings.manage') @Get(':currency')
  history(@Param('currency') currency: string) {
    return this.fx.history(currency.toUpperCase());
  }

  @RequirePermissions('settings.manage') @Get('status/stale')
  stale() {
    return this.fx.findStale().then((codes) => ({ stale: codes }));
  }

  @RequirePermissions('settings.manage') @Post(':currency')
  record(
    @Param('currency') currency: string,
    @Body('rate') rate: number,
    @CurrentUser('id') actorId: string,
  ) {
    return this.fx.recordRate(currency.toUpperCase(), rate, 'MANUAL', actorId);
  }
}
