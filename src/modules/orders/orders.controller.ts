import { Body, Controller, Get, HttpCode, Ip, Param, Post, Query, Req, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';

import { OrdersService } from './orders.service';
import { QuotesService } from './quotes.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { CreateOrderDto, CreateQuoteDto, QueryOrdersDto } from './dto/order.dto';

@ApiBearerAuth()
@ApiTags('checkout')
@Controller('checkout')
@UseInterceptors(IdempotencyInterceptor)
export class CheckoutController {
  constructor(private quotes: QuotesService, private orders: OrdersService) {}

  @ApiOperation({
    summary: 'Create a checkout quote',
    description:
      'Freezes sell price, provider cost, FX rate and tax for 15 minutes. ' +
      'The resulting order is built from these frozen values and performs no ' +
      'pricing arithmetic of its own.',
  })
  @ApiResponse({ status: 201, description: 'Quote created; binding for 15 minutes.' })
  @ApiResponse({ status: 400, description: 'OUT_OF_STOCK, FX_RATE_UNAVAILABLE or validation failure.' })
  // Quotes are cheap individually but each one is rows in two tables; this
  // stops a client loop from filling the table between sweeper runs.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('quotes')
  createQuote(@CurrentUser('id') userId: string, @Body() dto: CreateQuoteDto, @Ip() ip: string) {
    return this.quotes.create(userId, dto, ip);
  }

  @Get('quotes/:id')
  getQuote(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.quotes.findOne(id, userId);
  }

  @ApiOperation({
    summary: 'Create an order from a quote',
    description:
      'Consumes the quote and copies every monetary value verbatim. Requires ' +
      'an Idempotency-Key; a replay returns the original order rather than ' +
      'creating a second one.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: '8–200 chars, unique per intent.' })
  @ApiResponse({ status: 201, description: 'Order created, awaiting payment.' })
  @ApiResponse({ status: 400, description: 'QUOTE_EXPIRED or QUOTE_CONSUMED.' })
  @ApiResponse({ status: 409, description: 'IDEMPOTENCY_KEY_MISMATCH or REQUEST_IN_PROGRESS.' })
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Idempotent()
  @Post('orders')
  createOrder(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateOrderDto,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    return this.orders.createFromQuote(userId, dto.quoteId, { ip, userAgent: req.headers['user-agent'] });
  }
}

@ApiBearerAuth()
@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private orders: OrdersService) {}

  @Get()
  findMine(@CurrentUser('id') userId: string, @Query() query: QueryOrdersDto) {
    return this.orders.findAllForUser(userId, query);
  }

  @Get(':id')
  findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.orders.findOne(id, userId);
  }

  @ApiOperation({
    summary: 'Reveal a delivered code',
    description:
      'Decrypts and returns the delivered value. Separate from the order ' +
      'payload so codes do not sit in list responses, logs or browser caches. ' +
      'Every call is written to the audit log.',
  })
  @ApiResponse({ status: 403, description: 'The order belongs to another account.' })
  // Tightly limited: this is the endpoint that returns the actual goods.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('items/:itemId/reveal')
  reveal(@CurrentUser('id') userId: string, @Param('itemId') itemId: string) {
    return this.orders.revealResult(itemId, userId);
  }
}

@ApiBearerAuth()
@ApiTags('admin/orders')
@Controller('admin/orders')
export class OrdersAdminController {
  constructor(private orders: OrdersService) {}

  @RequirePermissions('orders.read') @Get()
  findAll(@Query() query: QueryOrdersDto) {
    return this.orders.findAllAdmin(query);
  }

  @RequirePermissions('orders.read') @Get(':id')
  findOne(@Param('id') id: string) {
    return this.orders.findOne(id);
  }

  @RequirePermissions('orders.cancel') @HttpCode(200) @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body('reason') reason: string, @CurrentUser('id') actorId: string) {
    return this.orders.cancelUnpaid(id, reason ?? 'Cancelled by staff', actorId);
  }
}
