import { Controller, Get, Header, UnauthorizedException, Headers } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { MetricsService } from './metrics.service';
import { Public } from '../decorators/public.decorator';

@ApiExcludeController()
@Public()
@Controller('metrics')
export class MetricsController {
  constructor(private metrics: MetricsService, private config: ConfigService) {}

  /**
   * Guarded by a bearer token rather than left open: the metric names alone
   * disclose order volume, revenue and provider relationships.
   *
   * Fails closed. Production is required to configure METRICS_TOKEN (enforced
   * by env validation), and if it is somehow absent we deny rather than expose
   * the endpoint. Outside production an unset token leaves it open for local
   * scraping.
   */
  @Get()
  @Header('content-type', 'text/plain; version=0.0.4')
  async scrape(@Headers('authorization') auth?: string) {
    const expected = this.config.get<string>('observability.metricsToken');
    if (!expected) {
      if (process.env.NODE_ENV === 'production') throw new UnauthorizedException();
      return this.metrics.scrape();
    }
    if (auth !== `Bearer ${expected}`) throw new UnauthorizedException();
    return this.metrics.scrape();
  }
}
