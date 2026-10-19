'use client';

import { useEffect, useState } from 'react';
import { shop } from './api';

export const GATEWAY_LABELS: Record<string, string> = {
  WALLET: 'رصيد المحفظة',
  MANUAL: 'تحويل (بنكيلي، مصرفي، أورنج موني، Binance…)',
  STRIPE: 'بطاقة بنكية',
};
export function gatewayLabel(g: string) {
  return GATEWAY_LABELS[g] ?? g;
}

/** Unpaid orders are cancelled after this many minutes (maintenance job). */
export const PAYMENT_WINDOW_MIN = 30;

/**
 * Methods worth offering for an amount: the wallet only when its balance
 * covers it. A card is offered in every country once the owner has connected a
 * card account (the API lists STRIPE only then); the card is typed on Stripe's
 * own page, never here.
 */
export function useUsableMethods(amount: number | null, currency: string | null) {
  const [methods, setMethods] = useState<string[] | null>(null);

  useEffect(() => {
    if (amount === null || !currency) return;
    let alive = true;
    Promise.all([shop.paymentMethods().catch(() => [] as string[]), shop.wallet().catch(() => [])]).then(
      ([codes, wallets]) => {
        if (!alive) return;
        const balance = Number(wallets.find((w) => w.currencyCode === currency)?.balance ?? 0);
        setMethods(codes.filter((c) => c !== 'WALLET' || balance >= amount));
      },
    );
    return () => {
      alive = false;
    };
  }, [amount, currency]);

  return methods;
}
