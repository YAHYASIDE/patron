import {
  Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CreateMarketDto, LinkAccountDto, MarketDecisionDto, UpdateMarketDto, UpsertMethodsDto, UpsertRulesDto,
} from './dto/markets.dto';
import { MarketsService } from './markets.service';

/** Either permission may read the markets (the guard's metadata means "all of"). */
export const MARKET_READERS = ['markets.manage', 'intelligence.read'];

export function assertCanReadMarkets(user: AuthUser | undefined) {
  if (user && (user.roles.includes('super_admin') || MARKET_READERS.some((p) => user.permissions.includes(p)))) return;
  throw new ForbiddenException(`Missing permission(s): one of ${MARKET_READERS.join(', ')}`);
}

/** What the store reads: enabled countries and their approved product rules. */
@ApiTags('markets')
@Controller('markets')
export class MarketsPublicController {
  constructor(private markets: MarketsService) {}

  @ApiOperation({ summary: 'Countries the store serves (enabled only)' })
  @Public() @Get()
  list() {
    return this.markets.publicList();
  }

  @ApiOperation({ summary: 'Approved product rules of a country, for the store notice' })
  @Public() @Get(':code/rules')
  rules(@Param('code') code: string) {
    return this.markets.publicRules(code);
  }
}

/**
 * Countries, the payment methods research found in each and product availability.
 * The owner decides; nothing here creates or edits a payment account.
 */
@ApiBearerAuth()
@ApiTags('admin/markets')
@Controller('admin/markets')
export class MarketsAdminController {
  constructor(private markets: MarketsService) {}

  @ApiOperation({ summary: 'Every country with its review counts (markets.manage or intelligence.read)' })
  @Get()
  list(@CurrentUser() user: AuthUser) {
    assertCanReadMarkets(user);
    return this.markets.list();
  }

  @ApiOperation({ summary: 'Add a country (switched off) and ask for its research' })
  @RequirePermissions('markets.manage') @Post()
  create(@Body() dto: CreateMarketDto, @CurrentUser('id') actorId: string) {
    return this.markets.create(dto, actorId);
  }

  @RequirePermissions('markets.manage') @HttpCode(200) @Post('methods/:id/decision')
  decideMethod(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MarketDecisionDto, @CurrentUser('id') actorId: string) {
    return this.markets.decideMethod(id, dto.action, dto.note, actorId);
  }

  @ApiOperation({ summary: 'Point an approved method at one of the owner\'s accounts for this country (the account is not changed)' })
  @RequirePermissions('markets.manage') @HttpCode(200) @Post('methods/:id/link-account')
  linkAccount(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkAccountDto, @CurrentUser('id') actorId: string) {
    return this.markets.linkAccount(id, dto.accountId, actorId);
  }

  @RequirePermissions('markets.manage') @HttpCode(200) @Post('rules/:id/decision')
  decideRule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MarketDecisionDto, @CurrentUser('id') actorId: string) {
    return this.markets.decideRule(id, dto.action, dto.note, actorId);
  }

  @ApiOperation({ summary: 'A country with its methods, rules and the owner\'s accounts serving it (numbers masked)' })
  @Get(':code')
  detail(@Param('code') code: string, @CurrentUser() user: AuthUser) {
    assertCanReadMarkets(user);
    return this.markets.detail(code);
  }

  @RequirePermissions('markets.manage') @Patch(':code')
  update(@Param('code') code: string, @Body() dto: UpdateMarketDto, @CurrentUser('id') actorId: string) {
    return this.markets.update(code, dto, actorId);
  }

  @ApiOperation({ summary: 'Record researched payment methods (new ones wait for review)' })
  @RequirePermissions('markets.manage') @HttpCode(200) @Post(':code/methods')
  upsertMethods(@Param('code') code: string, @Body() dto: UpsertMethodsDto, @CurrentUser('id') actorId: string) {
    return this.markets.upsertMethods(code, dto.items, { id: actorId, label: 'staff' });
  }

  @ApiOperation({ summary: 'Record researched product availability (new rules wait for review)' })
  @RequirePermissions('markets.manage') @HttpCode(200) @Post(':code/rules')
  upsertRules(@Param('code') code: string, @Body() dto: UpsertRulesDto, @CurrentUser('id') actorId: string) {
    return this.markets.upsertRules(code, dto.items, { id: actorId, label: 'staff' });
  }
}
