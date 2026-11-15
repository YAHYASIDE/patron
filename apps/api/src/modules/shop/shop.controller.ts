import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { ShopService } from './shop.service';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

export class ShopInfoDto {
  /** E.164, or empty to hide the WhatsApp button. */
  @IsString() @Matches(/^(\+[1-9]\d{7,14})?$/, { message: 'WhatsApp number must be E.164, e.g. +22222123456' })
  supportWhatsapp!: string;
}

@ApiTags('shop')
@Controller('shop')
export class ShopController {
  constructor(private shop: ShopService) {}

  @ApiOperation({ summary: "Public facts about the shop (its WhatsApp number)" })
  @Public() @Get('info')
  info() {
    return this.shop.info();
  }
}

@ApiBearerAuth()
@ApiTags('admin/shop')
@Controller('admin/shop')
export class ShopAdminController {
  constructor(private shop: ShopService) {}

  @RequirePermissions('settings.manage') @Put('info')
  setInfo(@Body() dto: ShopInfoDto, @CurrentUser('id') actorId: string) {
    return this.shop.setInfo(dto.supportWhatsapp, actorId);
  }
}
