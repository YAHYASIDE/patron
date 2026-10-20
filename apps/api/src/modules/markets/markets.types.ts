import { ProductAvailability } from '@prisma/client';

/**
 * Stand-in for the markets feature's own types (replaced when that work lands).
 * The intelligence ingest only needs these shapes to hand research over.
 */
export interface MarketSourceInput {
  url: string;
  title: string;
  publisher?: string;
  accessedAt: string;
}

export interface MarketMethodInput {
  key: string;
  name: string;
  provider?: string;
  kind: string;
  currency?: string;
  fees?: string;
  sources: MarketSourceInput[];
  confidence: number;
  verifiedBy: string;
}

export interface MarketRuleInput {
  scope: string;
  ref: string;
  availability: ProductAvailability;
  note?: string;
  sources: MarketSourceInput[];
  confidence: number;
  verifiedBy: string;
}

export interface MarketActor {
  id?: string;
  label: string;
}
