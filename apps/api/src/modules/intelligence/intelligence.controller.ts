import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { IntelligenceService } from './intelligence.service';
import { INGEST_TOKEN_HEADER, IngestRequest, IntelIngestGuard } from './ingest.guard';
import {
  AgentRunsQueryDto, DiscoveriesQueryDto, DiscoveryDecisionDto, IngestDto, LimitQueryDto,
} from './dto/intelligence.dto';

/**
 * The intelligence and development center ("فرص التطوير والاكتشافات"):
 * discoveries from agents, CI and the in-app scanners, and the owner's
 * decisions on them. Contract: docs/contracts/intelligence-api.md.
 */
@ApiBearerAuth()
@ApiTags('admin/intelligence')
@Controller('admin/intelligence')
export class IntelligenceController {
  constructor(private intel: IntelligenceService) {}

  @RequirePermissions('intelligence.read') @Get('summary')
  summary() {
    return this.intel.summary();
  }

  @RequirePermissions('intelligence.read') @Get('discoveries')
  list(@Query() q: DiscoveriesQueryDto) {
    return this.intel.list(q);
  }

  @RequirePermissions('intelligence.read') @Get('discoveries/:id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.intel.detail(id);
  }

  @ApiOperation({ summary: 'approve | reject | defer | reopen | start | done' })
  @RequirePermissions('intelligence.decide') @HttpCode(200) @Post('discoveries/:id/decision')
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DiscoveryDecisionDto, @CurrentUser('id') actorId: string) {
    return this.intel.decide(id, dto, actorId);
  }

  @RequirePermissions('intelligence.read') @Get('decisions')
  decisions(@Query() q: LimitQueryDto) {
    return this.intel.decisions(q.limit);
  }

  @RequirePermissions('intelligence.read') @Get('agent-runs')
  agentRuns(@Query() q: AgentRunsQueryDto) {
    return this.intel.agentRuns(q);
  }

  @ApiOperation({ summary: 'Run the in-app scanners now' })
  @Throttle({ expensive: { limit: 5, ttl: 60_000 } })
  @RequirePermissions('intelligence.decide') @HttpCode(200) @Post('scan')
  scan(@CurrentUser('id') actorId: string) {
    return this.intel.scan(actorId);
  }

  /** Public for the router; IntelIngestGuard checks the agent token or the staff session itself. */
  @ApiOperation({ summary: 'An agent or CI reports a run, its discoveries and market research' })
  @ApiHeader({ name: INGEST_TOKEN_HEADER, required: false, description: 'Equals env INTEL_INGEST_TOKEN (or use a staff bearer token)' })
  @Throttle({ strict: { limit: 10, ttl: 60_000 } })
  @Public() @UseGuards(IntelIngestGuard) @Post('ingest')
  ingest(@Body() dto: IngestDto, @Req() req: IngestRequest) {
    return this.intel.ingest(dto, req.intelActor ?? { label: 'unknown', via: 'token' });
  }
}
