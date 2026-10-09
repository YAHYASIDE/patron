import { Module } from '@nestjs/common';
import { CheckoutController, OrdersAdminController, OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { QuotesService } from './quotes.service';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  imports: [CatalogModule], // PricingService — the storefront and the quote must agree
  controllers: [CheckoutController, OrdersController, OrdersAdminController],
  providers: [OrdersService, QuotesService],
  exports: [OrdersService, QuotesService],
})
export class OrdersModule {}
