import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateAgentDto, QueryAgentsDto, RecordPayoutDto, UpdateAgentDto } from './agents.dto';
import { AgentsService } from './agents.service';
import { AgentSelfService } from './agent-self.service';
import { CommissionsService } from './commissions.service';

/** The owner's agents pages: accounts, rules, statements, payouts. */
@ApiBearerAuth()
@ApiTags('admin/agents')
@Controller('admin/agents')
@RequirePermissions('agents.manage')
export class AgentsAdminController {
  constructor(
    private agents: AgentsService,
    private commissions: CommissionsService,
  ) {}

  @ApiOperation({ summary: 'Agents with referral counts and statement totals' })
  @Get()
  findAll(@Query() query: QueryAgentsDto) {
    return this.agents.findAll(query);
  }

  @ApiOperation({ summary: 'Make an account (or a new WhatsApp number) an agent' })
  @Post()
  create(@Body() dto: CreateAgentDto, @CurrentUser('id') actorId: string) {
    return this.agents.create(dto, actorId);
  }

  @ApiOperation({ summary: 'An agent: statement, referrals, commissions, payouts' })
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.agents.findOne(id);
  }

  @ApiOperation({ summary: 'Change the rule (future orders), activate or deactivate, note' })
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAgentDto, @CurrentUser('id') actorId: string) {
    return this.agents.update(id, dto, actorId);
  }

  @ApiOperation({ summary: 'Record a payout: the chosen EARNED commissions become PAID' })
  @Post(':id/payouts')
  payout(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordPayoutDto, @CurrentUser('id') actorId: string) {
    return this.agents.recordPayout(id, dto, actorId);
  }

  @ApiOperation({ summary: 'Re-derive every commission of this agent from its orders (safe to repeat)' })
  @Post(':id/recompute') @HttpCode(200)
  async recompute(@Param('id', ParseUUIDPipe) id: string) {
    const counts = await this.commissions.syncAgent(id);
    return { ...counts, statement: await this.agents.statement(id) };
  }
}

/** An agent's own page in the store. */
@ApiBearerAuth()
@ApiTags('agent')
@Controller('agent/me')
@RequirePermissions('agents.self')
export class AgentSelfController {
  constructor(private self: AgentSelfService) {}

  @ApiOperation({ summary: 'My code, share link, counts and statement' })
  @Get()
  me(@CurrentUser('id') userId: string) {
    return this.self.me(userId);
  }

  @ApiOperation({ summary: 'The customers I brought (first name and masked number only)' })
  @Get('referrals')
  referrals(@CurrentUser('id') userId: string) {
    return this.self.referrals(userId);
  }

  @ApiOperation({ summary: 'My commissions' })
  @Get('commissions')
  commissions(@CurrentUser('id') userId: string) {
    return this.self.commissions(userId);
  }
}
