import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { RefundsService } from './refunds.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ProcessRefundDto, RefundsQueryDto, RejectRefundDto, RequestRefundDto } from '../payments/dto/payment.dto';

/**
 * Lives in RefundsModule rather than PaymentsModule.
 *
 * It used to be declared in payments.controller.ts, which forced
 * PaymentsModule to import RefundsModule while RefundsModule already imported
 * PaymentsModule for the gateway registry — a circular dependency papered over
 * with forwardRef. Moving the controller to the module that owns the service
 * removes the cycle instead of working around it: refunds now depend on
 * payments, and payments do not depend on refunds.
 */
@ApiBearerAuth()
@ApiTags('admin/refunds')
@Controller('admin/refunds')
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @RequirePermissions('payments.read') @Get()
  findAll(@Query() query: RefundsQueryDto) {
    return this.refunds.findAll(query.status);
  }

  @RequirePermissions('payments.refund') @Post()
  request(@Body() dto: RequestRefundDto, @CurrentUser('id') actorId: string) {
    return this.refunds.request(dto.orderId, dto.amount, dto.reason, actorId, dto.toWallet ?? false);
  }

  @RequirePermissions('payments.refund') @HttpCode(200) @Post(':id/process')
  process(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ProcessRefundDto, @CurrentUser('id') actorId: string) {
    return this.refunds.process(id, actorId, dto.reference);
  }

  @RequirePermissions('payments.refund') @HttpCode(200) @Post(':id/reject')
  // a validated body, not @Body('reason'): a raw field skips validation and may arrive as an array
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectRefundDto, @CurrentUser('id') actorId: string) {
    return this.refunds.reject(id, actorId, dto.reason);
  }
}
