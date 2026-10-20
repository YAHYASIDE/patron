import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequireAnyPermission, RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CreateMarketDto, LinkAccountDto, MarketDecisionDto, UpdateMarketDto, UpsertMethodsDto, UpsertRulesDto,
} from './dto/markets.dto';
import { MarketsService } from './markets.service';

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
  @RequireAnyPermission('markets.manage', 'intelligence.read') @Get()
  list() {
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
  @RequireAnyPermission('markets.manage', 'intelligence.read') @Get(':code')
  detail(@Param('code') code: string) {
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
