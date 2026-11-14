import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { BankNoticesService } from './bank-notices.service';
import {
  BankConfigDto, BankNoticesQueryDto, ConfirmBankNoticeDto, IgnoreBankNoticeDto, IngestBankNoticeDto,
} from './dto/bank-notices.dto';

/**
 * Bank notifications forwarded by the owner's Android phone. Evidence only:
 * no route here approves or changes a payment.
 */
@ApiBearerAuth()
@ApiTags('admin/bank-notices')
@Controller('admin/bank-notices')
export class BankNoticesController {
  constructor(private notices: BankNoticesService) {}

  @ApiOperation({ summary: 'The phone forwards one notification from an allowed bank app' })
  @RequirePermissions('bank.review') @Post()
  ingest(@Body() dto: IngestBankNoticeDto, @CurrentUser('id') actorId: string) {
    return this.notices.ingest(dto, actorId);
  }

  @RequirePermissions('bank.review') @Get()
  list(@Query() q: BankNoticesQueryDto) {
    return this.notices.list(q.status, q.limit);
  }

  /** The phone reads it to know which apps to listen to, so bank.review is enough. */
  @RequirePermissions('bank.review') @Get('config')
  config() {
    return this.notices.config();
  }

  @RequirePermissions('settings.manage') @Put('config')
  setConfig(@Body() dto: BankConfigDto, @CurrentUser('id') actorId: string) {
    return this.notices.setConfig(dto.allowedApps, actorId);
  }

  @ApiOperation({ summary: 'Record that this notice is the money of a payment (the payment is approved separately)' })
  @RequirePermissions('bank.review') @HttpCode(200) @Post(':id/confirm')
  confirm(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmBankNoticeDto, @CurrentUser('id') actorId: string) {
    return this.notices.confirm(id, dto.paymentId, actorId);
  }

  @RequirePermissions('bank.review') @HttpCode(200) @Post(':id/ignore')
  ignore(@Param('id', ParseUUIDPipe) id: string, @Body() dto: IgnoreBankNoticeDto, @CurrentUser('id') actorId: string) {
    return this.notices.ignore(id, actorId, dto.note);
  }
}
