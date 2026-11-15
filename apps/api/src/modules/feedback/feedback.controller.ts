import { Body, Controller, Get, Headers, HttpCode, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { FeedbackService } from './feedback.service';
import { PeriodQueryDto, ReportEventDto } from './dto/feedback.dto';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiTags('events')
@Public()
@Controller('events')
export class EventsController {
  constructor(
    private feedback: FeedbackService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  /** The customer behind an event, when the request carries a valid token; never an error. */
  private async userOf(authorization?: string): Promise<string | null> {
    // plain string checks, not a regex: the header is attacker-controlled
    if (!authorization || authorization.length > 4096 || authorization.slice(0, 7).toLowerCase() !== 'bearer ') return null;
    const token = authorization.slice(7).trim();
    if (!token) return null;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; type: string }>(token, {
        secret: this.config.getOrThrow<string>('jwt.accessSecret'),
      });
      return payload.type === 'access' ? payload.sub : null;
    } catch {
      return null;
    }
  }

  @ApiOperation({
    summary: 'Report what a visitor ran into',
    description: 'A search with no result, a brand page view, a product suggestion or a browser error.',
  })
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(202)
  @Post()
  async report(@Body() dto: ReportEventDto, @Headers('authorization') authorization?: string) {
    return this.feedback.record(dto, await this.userOf(authorization));
  }
}

@ApiBearerAuth()
@ApiTags('admin/feedback')
@Controller('admin')
export class FeedbackAdminController {
  constructor(private feedback: FeedbackService) {}

  @ApiOperation({ summary: 'Searches with no result, suggestions, unfinished checkouts, most viewed brands' })
  @RequirePermissions('reports.read') @Get('opportunities')
  opportunities(@Query() query: PeriodQueryDto) {
    return this.feedback.opportunities(query.days ?? 30);
  }

  @ApiOperation({ summary: 'Errors from the store, the dashboard and the server, grouped' })
  @RequirePermissions('reports.read') @Get('errors')
  errors(@Query() query: PeriodQueryDto) {
    return this.feedback.errors(query.days ?? 7);
  }
}
