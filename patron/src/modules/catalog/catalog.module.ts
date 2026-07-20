import { Module } from '@nestjs/common';
import { CatalogAdminController, CatalogPublicController } from './catalog.controller';
import { CategoriesService } from './categories.service';
import { GamesService } from './games.service';
import { ProductsService } from './products.service';
import { PricingService } from './pricing.service';

@Module({
  controllers: [CatalogPublicController, CatalogAdminController],
  providers: [CategoriesService, GamesService, ProductsService, PricingService],
  // PricingService is exported: Orders and Payments must reuse the exact
  // same conversion and rounding rules the storefront quoted.
  exports: [PricingService, ProductsService],
})
export class CatalogModule {}
