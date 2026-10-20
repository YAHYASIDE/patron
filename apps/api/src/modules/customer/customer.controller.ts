import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CustomerService } from './customer.service';
import { WatchesService } from './watches.service';
import { StoreFactsService } from './store-facts.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { BestSellersQueryDto, CreateWatchDto, SavedInputsQueryDto, SaveInputDto } from './dto/customer.dto';

// ─────────────── the signed-in customer's own data ───────────────

@ApiBearerAuth()
@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(private customer: CustomerService, private watches: WatchesService) {}

  @ApiOperation({ summary: 'Account IDs I saved, newest first' })
  @Get('saved-inputs')
  savedInputs(@CurrentUser('id') userId: string, @Query() query: SavedInputsQueryDto) {
    return this.customer.listSavedInputs(userId, query.gameId);
  }

  @ApiOperation({ summary: 'Save account IDs for a game', description: 'The same values again only move to the top; 10 per game.' })
  @Post('saved-inputs')
  saveInput(@CurrentUser('id') userId: string, @Body() dto: SaveInputDto) {
    return this.customer.saveInput(userId, dto);
  }

  @Delete('saved-inputs/:id')
  deleteInput(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.customer.deleteSavedInput(userId, id);
  }

  @ApiOperation({ summary: 'My favourite brand keys' })
  @Get('favorites')
  favorites(@CurrentUser('id') userId: string) {
    return this.customer.listFavorites(userId);
  }

  @Put('favorites/:brandKey')
  addFavorite(@CurrentUser('id') userId: string, @Param('brandKey') brandKey: string) {
    return this.customer.addFavorite(userId, brandKey);
  }

  @Delete('favorites/:brandKey')
  removeFavorite(@CurrentUser('id') userId: string, @Param('brandKey') brandKey: string) {
    return this.customer.removeFavorite(userId, brandKey);
  }

  @ApiOperation({ summary: 'My price and stock alerts' })
  @Get('watches')
  watchList(@CurrentUser('id') userId: string) {
    return this.watches.list(userId);
  }

  @ApiOperation({ summary: 'Alert me when the price drops or the product is back' })
  @Post('watches')
  watch(@CurrentUser('id') userId: string, @Body() dto: CreateWatchDto) {
    return this.watches.create(userId, dto);
  }

  @Delete('watches/:id')
  unwatch(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.watches.remove(userId, id);
  }

  @ApiOperation({ summary: 'Every delivered item, newest first', description: 'Values are read with POST /orders/items/:itemId/reveal.' })
  @Get('codes')
  codes(@CurrentUser('id') userId: string) {
    return this.customer.myCodes(userId);
  }
}

// ─────────────── public store facts ───────────────

@ApiTags('catalog')
@Public()
@Controller('catalog')
export class StoreFactsController {
  constructor(private facts: StoreFactsService) {}

  @ApiOperation({ summary: 'Best sellers: delivered units in the last 30 days' })
  @Get('best-sellers')
  bestSellers(@Query() query: BestSellersQueryDto) {
    return this.facts.bestSellers(query.limit ?? 8);
  }

  @ApiOperation({ summary: 'Orders delivered and customers (cached 10 min)' })
  @Get('stats')
  stats() {
    return this.facts.stats();
  }

  @ApiOperation({ summary: 'Latest exchange rates from the base currency' })
  @Get('rates')
  rates() {
    return this.facts.rates();
  }
}
