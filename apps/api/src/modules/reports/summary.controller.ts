import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ReportSummaryService } from './summary.service';
import { ReportSummaryQueryDto } from './dto/summary.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

/** The owner's reports page: one request for everything it shows. */
@ApiBearerAuth()
@ApiTags('admin/reports')
@RequirePermissions('reports.read')
// Same budget as the other report routes: a handful of aggregates per call.
@Throttle({ default: { limit: 20, ttl: 60_000 } })
@Controller('admin/reports')
export class ReportSummaryController {
  constructor(private summaries: ReportSummaryService) {}

  @ApiOperation({
    summary: 'Profit and losses, today, payment apps, best customers and products, by country and by day (USD)',
  })
  @Get('summary')
  summary(@Query() query: ReportSummaryQueryDto) {
    return this.summaries.summary(query);
  }
}
