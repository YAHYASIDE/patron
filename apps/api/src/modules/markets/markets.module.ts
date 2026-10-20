import { Module } from '@nestjs/common';

import { MarketsService } from './markets.service';

/** Markets & intelligence — filled in by its feature work. */
@Module({
  controllers: [],
  providers: [MarketsService],
  exports: [MarketsService],
})
export class MarketsModule {}
