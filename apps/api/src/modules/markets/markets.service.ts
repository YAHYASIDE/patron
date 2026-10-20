import { Injectable, NotImplementedException } from '@nestjs/common';

import { MarketActor, MarketMethodInput, MarketRuleInput } from './markets.types';

const notReady = (code: string) =>
  Promise.reject<{ created: number; updated: number }>(
    new NotImplementedException({ message: `Markets are not available yet (${code})`, error: 'MARKETS_NOT_READY' }),
  );

/**
 * Stand-in so the intelligence ingest compiles; the markets feature replaces
 * this file with the real upserts (contract: docs/contracts/intelligence-api.md).
 */
@Injectable()
export class MarketsService {
  upsertMethods(code: string, items: MarketMethodInput[], actor: MarketActor): Promise<{ created: number; updated: number }> {
    void items;
    void actor;
    return notReady(code);
  }

  upsertRules(code: string, items: MarketRuleInput[], actor: MarketActor): Promise<{ created: number; updated: number }> {
    void items;
    void actor;
    return notReady(code);
  }
}
