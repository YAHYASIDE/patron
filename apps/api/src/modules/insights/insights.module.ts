import { Module } from '@nestjs/common';
import { InsightsController } from './insights.controller';
import { InsightsService } from './insights.service';
import { FxModule } from '../fx/fx.module';

@Module({
  // FxService.findStale is the one definition of a stale rate; reuse it.
  imports: [FxModule],
  controllers: [InsightsController],
  providers: [InsightsService],
})
export class InsightsModule {}
