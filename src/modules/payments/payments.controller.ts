import {
  Body, Controller, Get, Headers, HttpCode, Param, Post, Req, UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';

import { PaymentsService } from './payments.service';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { InitiatePaymentDto } from './dto/payment.dto';

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
  // Generous: a gateway retry storm must not be throttled into a lost capture.
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @ApiOperation({ summary: 'Inbound gateway webhook (signature verified against the raw body)' })
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
