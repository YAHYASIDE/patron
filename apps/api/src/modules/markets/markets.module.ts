import { Module } from '@nestjs/common';

import { MarketsAdminController, MarketsPublicController } from './markets.controller';
import { MarketsService } from './markets.service';

/**
 * Countries, their payment methods (knowledge, not accounts) and product availability.
 * MarketsService is exported for the intelligence ingest.
 */
@Module({
  controllers: [MarketsPublicController, MarketsAdminController],
  providers: [MarketsService],
  exports: [MarketsService],
})
export class MarketsModule {}
