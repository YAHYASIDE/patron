import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CategoriesService } from './categories.service';
import { GamesService } from './games.service';
import { ProductsService } from './products.service';
import { PricingService } from './pricing.service';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateCategoryDto, CreateGameDto, CreateProductDto, QueryCatalogDto,
  UpdateCategoryDto, UpdateGameDto, UpdateProductDto,
} from './dto/catalog.dto';

// ─────────────── Storefront (public) ───────────────

@ApiTags('catalog')
@Public()
@Controller('catalog')
export class CatalogPublicController {
  constructor(
    private categories: CategoriesService,
    private games: GamesService,
    private products: ProductsService,
    private pricing: PricingService,
  ) {}

  @Get('currencies') currencies() { return this.pricing.listCurrencies(); }

  @Get('categories') categoryTree() { return this.categories.findTree(); }

  @Get('categories/:idOrSlug') category(@Param('idOrSlug') idOrSlug: string) {
    return this.categories.findOne(idOrSlug);
  }

  @Get('games') gameList(@Query() query: QueryCatalogDto) { return this.games.findAll(query); }

  @Get('games/:idOrSlug') game(@Param('idOrSlug') idOrSlug: string) { return this.games.findOne(idOrSlug); }

  @Get('products') productList(@Query() query: QueryCatalogDto) {
    return this.products.findAllPublic(query);
  }

  @Get('products/:idOrSku') product(@Param('idOrSku') idOrSku: string, @Query('currency') currency?: string) {
    return this.products.findOnePublic(idOrSku, currency);
  }
}

// ─────────────── Admin ───────────────

@ApiBearerAuth()
@ApiTags('admin/catalog')
@Controller('admin/catalog')
export class CatalogAdminController {
  constructor(
    private categories: CategoriesService,
    private games: GamesService,
    private products: ProductsService,
  ) {}

  // Categories
  @RequirePermissions('catalog.read') @Get('categories')
  listCategories() { return this.categories.findAll(); }

  @RequirePermissions('catalog.write') @Post('categories')
  createCategory(@Body() dto: CreateCategoryDto, @CurrentUser('id') actorId: string) {
    return this.categories.create(dto, actorId);
  }

  @RequirePermissions('catalog.write') @Patch('categories/:id')
  updateCategory(@Param('id') id: string, @Body() dto: UpdateCategoryDto, @CurrentUser('id') actorId: string) {
    return this.categories.update(id, dto, actorId);
  }

  @RequirePermissions('catalog.delete') @Delete('categories/:id')
  removeCategory(@Param('id') id: string, @CurrentUser('id') actorId: string) {
    return this.categories.remove(id, actorId);
  }

  // Games
  @RequirePermissions('catalog.read') @Get('games')
  listGames(@Query() query: QueryCatalogDto) { return this.games.findAll(query, true); }

  @RequirePermissions('catalog.write') @Post('games')
  createGame(@Body() dto: CreateGameDto, @CurrentUser('id') actorId: string) {
    return this.games.create(dto, actorId);
  }

  @RequirePermissions('catalog.write') @Patch('games/:id')
  updateGame(@Param('id') id: string, @Body() dto: UpdateGameDto, @CurrentUser('id') actorId: string) {
    return this.games.update(id, dto, actorId);
  }

  @RequirePermissions('catalog.delete') @Delete('games/:id')
  removeGame(@Param('id') id: string, @CurrentUser('id') actorId: string) {
    return this.games.remove(id, actorId);
  }

  // Products
  @RequirePermissions('catalog.read') @Get('products')
  listProducts(@Query() query: QueryCatalogDto) { return this.products.findAllAdmin(query); }

  @RequirePermissions('catalog.write') @Post('products')
  createProduct(@Body() dto: CreateProductDto, @CurrentUser('id') actorId: string) {
    return this.products.create(dto, actorId);
  }

  // Price and cost edits are separately gated from ordinary catalog edits.
  @RequirePermissions('catalog.write', 'catalog.pricing') @Patch('products/:id')
  updateProduct(@Param('id') id: string, @Body() dto: UpdateProductDto, @CurrentUser('id') actorId: string) {
    return this.products.update(id, dto, actorId);
  }

  @RequirePermissions('catalog.delete') @Delete('products/:id')
  removeProduct(@Param('id') id: string, @CurrentUser('id') actorId: string) {
    return this.products.remove(id, actorId);
  }
}
