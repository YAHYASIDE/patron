import { Module } from '@nestjs/common';
import { ShopAdminController, ShopController } from './shop.controller';
import { ShopService } from './shop.service';

@Module({
  controllers: [ShopController, ShopAdminController],
  providers: [ShopService],
})
export class ShopModule {}
