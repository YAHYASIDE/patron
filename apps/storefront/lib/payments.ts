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
 * Methods worth offering for an amount: the wallet only when its balance covers
 * it, and no card payment yet (the API can take Stripe payments, but the shop
 * has no card form, so offering it would lead nowhere).
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
        setMethods(codes.filter((c) => c !== 'STRIPE' && (c !== 'WALLET' || balance >= amount)));
      },
    );
    return () => {
      alive = false;
    };
  }, [amount, currency]);

  return methods;
}
