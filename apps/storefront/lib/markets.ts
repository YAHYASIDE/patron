'use client';

import { useEffect, useState } from 'react';
import { request } from './api';
import { OTHER_REGION, REGIONS } from './regions';

/**
 * The countries the shop serves, as the owner set them in the dashboard
 * (GET /markets), with the static REGIONS as the answer when the API cannot be
 * reached. Read-only knowledge: which payment accounts a customer sees is still
 * decided by `servesRegion` in regions.ts, and this file does not change it.
 */
export type Market = {
  code: string;
  currency: string;
  currencies: string[];
  nameAr?: string;
  nameFr?: string;
  nameEn?: string;
  languages?: string[];
  dialCode?: string;
};

export type Availability = 'AVAILABLE' | 'UNAVAILABLE' | 'REGION_ACCOUNT_REQUIRED' | 'UNKNOWN';

/** An approved rule: whether a product, brand or category works in a country. */
export type MarketRule = {
  scope: 'product' | 'brand' | 'category';
  ref: string;
  availability: Availability;
  note: string | null;
};

/** The static list, used when the API does not answer. */
export const FALLBACK_MARKETS: Market[] = REGIONS.filter((r) => r.id !== OTHER_REGION).map((r) => ({
  code: r.id,
  currency: r.currencies[0],
  currencies: [...r.currencies],
}));

let markets: Promise<Market[]> | null = null;
const rules = new Map<string, Promise<MarketRule[]>>();

/** Enabled countries, fetched once per page load; a failed fetch falls back and is retried next time. */
export function loadMarkets(): Promise<Market[]> {
  if (!markets) {
    markets = request<Market[]>('/markets').then(
      (list) => (Array.isArray(list) && list.length ? list : FALLBACK_MARKETS),
      () => {
        markets = null;
        return FALLBACK_MARKETS;
      },
    );
  }
  return markets;
}

/** Approved product rules of a country; nothing when the call fails (the store then shows no notice). */
export function loadMarketRules(code: string): Promise<MarketRule[]> {
  if (!/^[A-Z]{2}$/.test(code) || code === OTHER_REGION) return Promise.resolve([]);
  let p = rules.get(code);
  if (!p) {
    p = request<MarketRule[]>(`/markets/${code}/rules`).then(
      (list) => (Array.isArray(list) ? list : []),
      () => {
        rules.delete(code);
        return [];
      },
    );
    rules.set(code, p);
  }
  return p;
}

/** The availability that deserves a notice on a brand's page, if the country has one for it. */
export function brandRestriction(
  list: MarketRule[],
  brandKey: string,
): 'UNAVAILABLE' | 'REGION_ACCOUNT_REQUIRED' | null {
  const rule = list.find((r) => r.scope === 'brand' && r.ref === brandKey);
  return rule?.availability === 'UNAVAILABLE' || rule?.availability === 'REGION_ACCOUNT_REQUIRED'
    ? rule.availability
    : null;
}

export function useMarkets(): Market[] {
  const [list, setList] = useState<Market[]>(FALLBACK_MARKETS);
  useEffect(() => {
    let alive = true;
    loadMarkets().then((l) => alive && setList(l));
    return () => {
      alive = false;
    };
  }, []);
  return list;
}

/** A brand's restriction in the customer's region, or null (also while loading and on any failure). */
export function useBrandRestriction(brandKey: string, region: string) {
  const [state, setState] = useState<{ key: string; value: ReturnType<typeof brandRestriction> }>({
    key: '',
    value: null,
  });
  const key = `${region}:${brandKey}`;
  useEffect(() => {
    let alive = true;
    loadMarketRules(region)
      .then((list) => alive && setState({ key, value: brandRestriction(list, brandKey) }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [key, region, brandKey]);
  return state.key === key ? state.value : null;
}
