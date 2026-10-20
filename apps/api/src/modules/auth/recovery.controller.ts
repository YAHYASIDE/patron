import { Body, Controller, Get, HttpCode, Ip, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RecoveryService } from './recovery.service';
import { RecoveryCompleteDto, RecoveryListQuery, RecoveryRequestDto, RecoveryReviewDto } from './dto/auth.dto';

const meta = (req: Request, ip: string) => ({ ip, userAgent: req.headers['user-agent'] });

/** A customer who lost access asks for help, then finishes with the code that reached them. */
@ApiTags('auth/recovery')
@Controller('auth/recovery')
export class RecoveryController {
  constructor(private recovery: RecoveryService) {}

  @ApiOperation({
    summary: 'Ask support to help recover an account',
    description: 'Same answer whether an account matches or not. Staff check the proof, then a code is sent to the contact given.',
  })
  @ApiResponse({ status: 200, description: '{ message } — always the same.' })
  @Public()
  @Throttle({ default: { limit: 3, ttl: 600_000 } })
  @HttpCode(200)
  @Post()
  request(@Body() dto: RecoveryRequestDto, @Req() req: Request, @Ip() ip: string) {
    return this.recovery.request(dto, meta(req, ip));
  }

  @ApiOperation({ summary: 'Finish a recovery: the code that reached the contact, and a new password' })
  @ApiResponse({ status: 200, description: '{ message, identifier } — sign in with it and the new password.' })
  @ApiResponse({ status: 400, description: 'INVALID_CODE.' })
  @Public()
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @HttpCode(200)
  @Post('complete')
  complete(@Body() dto: RecoveryCompleteDto, @Req() req: Request, @Ip() ip: string) {
    return this.recovery.complete(dto, meta(req, ip));
  }
}

/**
 * Staff review of recovery requests. Staff confirm who the customer is; the
 * system sends the code. No route here reveals a code or sets a password.
 */
@ApiBearerAuth()
@ApiTags('admin/recovery')
@Controller('admin/recovery')
export class RecoveryAdminController {
  constructor(private recovery: RecoveryService) {}

  @ApiOperation({ summary: 'Recovery requests (open by default) with the account and its recent orders' })
  @RequirePermissions('recovery.review')
  @Get()
  list(@Query() q: RecoveryListQuery) {
    return this.recovery.list(q.status);
  }

  @ApiOperation({
    summary: 'Confirm ownership: the system sends a reset code to the customer',
    description: 'Calling it again on a verified request re-sends the code (cooldown applies). Staff never see the code.',
  })
  @ApiResponse({ status: 409, description: 'RECOVERY_NO_ACCOUNT, RECOVERY_CHANNEL_UNAVAILABLE, RECOVERY_CONTACT_TAKEN or RECOVERY_CLOSED.' })
  @RequirePermissions('recovery.review')
  @HttpCode(200)
  @Post(':id/verify')
  verify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecoveryReviewDto,
    @CurrentUser('id') actorId: string,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    return this.recovery.verify(id, actorId, dto.note, meta(req, ip));
  }

  @ApiOperation({ summary: 'Reject a recovery request (any code already sent stops working)' })
  @RequirePermissions('recovery.review')
  @HttpCode(200)
  @Post(':id/reject')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecoveryReviewDto,
    @CurrentUser('id') actorId: string,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    return this.recovery.reject(id, actorId, dto.note, meta(req, ip));
  }
}
