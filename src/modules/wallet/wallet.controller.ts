import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { WalletService } from './wallet.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AdjustWalletDto } from '../payments/dto/payment.dto';

@ApiBearerAuth()
@ApiTags('wallet')
@Controller('wallet')
export class WalletController {
  constructor(private wallet: WalletService) {}

  @Get() balances(@CurrentUser('id') userId: string) {
    return this.wallet.listForUser(userId);
  }

  @Get('transactions')
  history(@CurrentUser('id') userId: string, @Query('currency') currency?: string) {
    return this.wallet.history(userId, currency);
  }

  @RequirePermissions('wallet.adjust') @HttpCode(200) @Post('adjust')
  adjust(@Body() dto: AdjustWalletDto, @CurrentUser('id') actorId: string) {
    return this.wallet.adjust(dto.userId, dto.currency, dto.amount, dto.reason, actorId);
  }
}
