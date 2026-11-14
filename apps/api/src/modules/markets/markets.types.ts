import { ProductAvailability } from '@prisma/client';

/** Where a researched fact comes from: the provider's own page first, then the regulator, then the press. */
export interface MarketSource {
  url: string;
  title: string;
  publisher?: string;
  /** ISO 8601 date the page was read. */
  accessedAt: string;
}

/** One payment method found in a country, as research reports it (never an account). */
export interface MarketMethodInput {
  /** stable key, e.g. orange-money-ml */
  key: string;
  name: string;
  provider?: string;
  /** mobile | mobile_money | bank | card | crypto | cash | other */
  kind: string;
  currency?: string;
  /** documented fees, as the source states them */
  fees?: string;
  /** what research could not confirm, shown to the owner next to the method */
  note?: string;
  sources: MarketSource[];
  /** 0–100 */
  confidence: number;
  /** who checked it: a staff label or an agent name (market-scout) */
  verifiedBy: string;
}

/** Whether a product, brand or category works in a country. */
export interface MarketRuleInput {
  scope: MarketRuleScope;
  /** sku, brand key or category slug */
  ref: string;
  availability: ProductAvailability;
  /** short text the store may show */
  note?: string;
  sources: MarketSource[];
  confidence: number;
  verifiedBy: string;
}

/** Who wrote: a staff member (id) or an agent / the ingest token (label only). */
export interface MarketActor {
  id?: string;
  label: string;
}

export const METHOD_KINDS = ['mobile', 'mobile_money', 'bank', 'card', 'crypto', 'cash', 'other'] as const;
export const RULE_SCOPES = ['product', 'brand', 'category'] as const;
export type MarketRuleScope = (typeof RULE_SCOPES)[number];
export const AVAILABILITIES = Object.values(ProductAvailability);

export const DECISION_ACTIONS = ['approve', 'reject', 'defer'] as const;
export type MarketDecisionAction = (typeof DECISION_ACTIONS)[number];

/** System setting: days after which a researched method or rule needs checking again. */
export const STALE_DAYS_KEY = 'markets.stale_days';
export const DEFAULT_STALE_DAYS = 90;
