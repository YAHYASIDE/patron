import {
  Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';

import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { imageInterceptor, sendImage } from '../uploads/uploads.controller';
import { IncomingFile } from '../uploads/uploads.service';
import { UsdtService } from './usdt.service';
import { UsdtConfigService } from './usdt-config.service';
import {
  CompleteUsdtOrderDto, CreateUsdtOrderDto, RejectUsdtOrderDto, SubmitUsdtPaymentDto, UsdtConfigDto, UsdtOrdersQueryDto, UsdtQuoteDto,
} from './dto/usdt.dto';

@ApiBearerAuth()
@ApiTags('usdt')
@Controller('usdt')
@UseInterceptors(IdempotencyInterceptor)
export class UsdtController {
  constructor(private usdt: UsdtService, private config: UsdtConfigService) {}

  @ApiOperation({ summary: 'Whether USDT is on sale, and the terms the store shows' })
  @Public() @Get('config')
  publicConfig() {
    return this.config.publicSummary();
  }

  @ApiOperation({ summary: 'Price a USDT purchase (rate, fee, total) without creating anything' })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200) @Post('quote')
  quote(@CurrentUser('id') userId: string, @Body() dto: UsdtQuoteDto) {
    return this.usdt.quote(userId, dto);
  }

  @ApiOperation({ summary: 'Create a USDT order with the rate, fee and total frozen; awaits payment' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Idempotent()
  @Post('orders')
  create(
    @CurrentUser('id') userId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() dto: CreateUsdtOrderDto,
  ) {
    return this.usdt.create(userId, key, dto);
  }

  @Get('orders')
  mine(@CurrentUser('id') userId: string) {
    return this.usdt.listMine(userId);
  }

  @Get('orders/:id')
  one(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.usdt.forCustomer(id, userId);
  }

  @ApiOperation({ summary: 'Attach a screenshot of the transfer (required before reporting the payment)' })
  @ApiConsumes('multipart/form-data')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200) @Post('orders/:id/proof')
  @UseInterceptors(imageInterceptor())
  proof(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: IncomingFile) {
    return this.usdt.attachProof(userId, id, file);
  }

  @ApiOperation({ summary: 'Report the transfer: which account was paid and from which number' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200) @Post('orders/:id/payment')
  pay(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitUsdtPaymentDto) {
    return this.usdt.submitPayment(userId, id, dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200) @Post('orders/:id/cancel')
  cancel(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.usdt.cancel(userId, id);
  }
}

@ApiBearerAuth()
@ApiTags('admin/usdt')
@Controller('admin/usdt')
export class UsdtAdminController {
  constructor(private usdt: UsdtService, private config: UsdtConfigService) {}

  @RequirePermissions('usdt.read') @Get('config')
  getConfig() {
    return this.config.get();
  }

  @ApiOperation({ summary: 'Set the switch, rates, fees, limits and networks (switching on needs legalApproval)' })
  @RequirePermissions('usdt.manage') @Put('config')
  setConfig(@Body() dto: UsdtConfigDto, @CurrentUser('id') actorId: string) {
    return this.config.update(dto, actorId);
  }

  @RequirePermissions('usdt.read') @Get('orders')
  list(@Query() q: UsdtOrdersQueryDto) {
    return this.usdt.list(q);
  }

  @RequirePermissions('usdt.read') @Get('orders/:id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.usdt.detail(id);
  }

  /** The customer's receipt, private to staff. */
  @RequirePermissions('usdt.read') @Get('orders/:id/proof')
  async receipt(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    sendImage(res, await this.usdt.proof(id), 'private, no-store');
  }

  @ApiOperation({ summary: 'The payment arrived: ready to send (by hand)' })
  @RequirePermissions('usdt.manage') @HttpCode(200) @Post('orders/:id/approve')
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') actorId: string) {
    return this.usdt.approve(actorId, id);
  }

  @ApiOperation({ summary: 'Record the TXID of the transfer staff made; completes the order' })
  @RequirePermissions('usdt.manage') @HttpCode(200) @Post('orders/:id/complete')
  complete(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteUsdtOrderDto, @CurrentUser('id') actorId: string) {
    return this.usdt.complete(actorId, id, dto.txid);
  }

  @RequirePermissions('usdt.manage') @HttpCode(200) @Post('orders/:id/reject')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectUsdtOrderDto, @CurrentUser('id') actorId: string) {
    return this.usdt.reject(actorId, id, dto.reason);
  }
}
