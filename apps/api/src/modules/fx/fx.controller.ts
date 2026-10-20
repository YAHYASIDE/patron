import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { FxService } from './fx.service';
import { CurrencyParamDto, RecordRateDto } from './dto/fx.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiBearerAuth()
@ApiTags('admin/fx')
@Controller('admin/fx')
export class FxController {
  constructor(private fx: FxService) {}

  @ApiOperation({ summary: 'Every currency the shop sells in, with its current rate and whether it is stale' })
  @RequirePermissions('settings.manage') @Get()
  overview() {
    return this.fx.overview();
  }

  @RequirePermissions('settings.manage') @Get(':currency')
  history(@Param() { currency }: CurrencyParamDto) {
    return this.fx.history(currency.toUpperCase());
  }

  @RequirePermissions('settings.manage') @Get('status/stale')
  stale() {
    return this.fx.findStale().then((codes) => ({ stale: codes }));
  }

  @ApiOperation({
    summary: "Set the owner's rate for a currency",
    description: 'A move of more than 15% answers 409 BIG_CHANGE until sent again with confirm: true.',
  })
  @RequirePermissions('settings.manage') @Post(':currency')
  record(@Param() { currency }: CurrencyParamDto, @Body() dto: RecordRateDto, @CurrentUser('id') actorId: string) {
    return this.fx.setManual(currency.toUpperCase(), dto.rate, actorId, dto.confirm ?? false);
  }
}
