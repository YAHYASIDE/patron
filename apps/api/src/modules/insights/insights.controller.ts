import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { InsightsService } from './insights.service';
import { OverviewQueryDto } from './insights.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiBearerAuth()
@ApiTags('admin/insights')
@Controller('admin/insights')
export class InsightsController {
  constructor(private insights: InsightsService) {}

  @ApiOperation({ summary: 'Today vs yesterday, what is waiting, low stock, margin and FX alerts' })
  @RequirePermissions('reports.read') @Get('overview')
  overview(@Query() query: OverviewQueryDto) {
    return this.insights.overview(query);
  }

  @ApiOperation({ summary: 'Latest order and waiting counts (polled by the open dashboard)' })
  @RequirePermissions('orders.read') @Get('pulse')
  pulse() {
    return this.insights.pulse();
  }

  @ApiOperation({ summary: 'Customers, orders and revenue by country and city' })
  @RequirePermissions('users.read') @Get('locations')
  locations() {
    return this.insights.locations();
  }
}
