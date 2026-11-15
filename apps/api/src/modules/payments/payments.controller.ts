import {
  Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { imageInterceptor, sendImage } from '../uploads/uploads.controller';
import { IncomingFile } from '../uploads/uploads.service';

import { PaymentsService } from './payments.service';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { InitiatePaymentDto, ManualAccountsDto, RejectPaymentDto, SubmitTransferDto } from './dto/payment.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiBearerAuth()
@ApiTags('payments')
@Controller('payments')
@UseInterceptors(IdempotencyInterceptor)
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  @Public() @Get('methods')
  methods() {
    return this.payments.availableMethods();
  }

  @ApiOperation({
    summary: 'Start payment for an order',
    description:
      'The amount is taken from the order, never from the request. Returns ' +
      'CAPTURED for instant methods, or REQUIRES_ACTION with a redirect for card.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiResponse({ status: 400, description: 'INSUFFICIENT_FUNDS or the order is not awaiting payment.' })
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Idempotent()
  @Post()
  initiate(@CurrentUser('id') userId: string, @Body() dto: InitiatePaymentDto) {
    return this.payments.initiate(dto.orderId, userId, dto.gateway, dto.returnUrl);
  }

  /** Where to send a manual transfer: the owner's accounts and note. */
  @Public() @Get('manual-accounts')
  manualAccounts() {
    return this.payments.manualInstructions();
  }

  @ApiOperation({ summary: 'Attach a screenshot of a manual transfer (required before reporting it)' })
  @ApiConsumes('multipart/form-data')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200) @Post(':id/proof')
  @UseInterceptors(imageInterceptor())
  attachProof(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: IncomingFile,
  ) {
    return this.payments.attachProof(id, userId, file);
  }

  @ApiOperation({
    summary: 'Report a manual transfer',
    description: 'The customer gives the number they paid from (the receipt is already attached); staff then approve or reject.',
  })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200) @Post(':id/transfer')
  submitTransfer(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitTransferDto,
  ) {
    return this.payments.submitTransfer(id, userId, dto);
  }

  /** Client-triggered confirmation — verified against the gateway, not trusted. */
  @HttpCode(200) @Post(':id/confirm')
  confirm(@Param('id') id: string) {
    return this.payments.confirm(id);
  }
}

@ApiTags('webhooks')
@Public()
@Controller('webhooks')
export class WebhooksController {
  constructor(private payments: PaymentsService) {}

  /**
   * Requires the raw body for signature verification — `main.ts` keeps it via
   * `rawBody: true`. Parsing before verifying would let a re-serialised payload
   * pass a signature it should fail.
   */
  @ApiOperation({
    summary: 'Inbound gateway webhook',
    description:
      'Signature is verified against the raw body before parsing. Replays are ' +
      'rejected by a unique (source, eventId) constraint.',
  })
  // Gateways retry aggressively during an incident; the limit is high because
  // dropping a capture webhook is far worse than absorbing the load.
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @HttpCode(200)
  @Post('payments/:source')
  handle(
    @Param('source') source: string,
    @Req() req: Request & { rawBody?: Buffer },
    @Headers() headers: Record<string, string>,
    @Body() body: unknown,
  ) {
    return this.payments.handleWebhook(source, req.rawBody?.toString() ?? JSON.stringify(body), headers, body);
  }
}

@ApiBearerAuth()
@ApiTags('admin/payments')
@Controller('admin/payments')
export class PaymentsAdminController {
  constructor(private payments: PaymentsService) {}

  /** Manual transfers customers reported, waiting for staff to check the account. */
  @RequirePermissions('payments.read') @Get('manual/pending')
  pending() {
    return this.payments.listManualPending();
  }

  @RequirePermissions('orders.fulfil_manual') @HttpCode(200) @Post(':id/approve')
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') actorId: string) {
    return this.payments.approveManual(id, actorId);
  }

  @RequirePermissions('orders.fulfil_manual') @HttpCode(200) @Post(':id/reject')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectPaymentDto, @CurrentUser('id') actorId: string) {
    return this.payments.rejectManual(id, dto.reason, actorId);
  }

  /** The customer's receipt, private to staff. */
  @RequirePermissions('payments.read') @Get(':id/proof')
  async proof(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    sendImage(res, await this.payments.proof(id), 'private, no-store');
  }

  /** Every account, switched-off ones included. */
  @RequirePermissions('settings.manage') @Get('manual-accounts')
  manualAccounts() {
    return this.payments.manualInstructions(true);
  }

  @RequirePermissions('settings.manage') @Put('manual-accounts')
  setManualAccounts(@Body() dto: ManualAccountsDto, @CurrentUser('id') actorId: string) {
    return this.payments.setManualInstructions(dto, actorId);
  }
}
