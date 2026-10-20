'use client';

import { catalog } from './api';
import { cart } from './cart';
import { getLang } from './i18n';
import type { Order } from './types';

const MASKED = '••••';

/**
 * Put an earlier order's items back in the cart at today's prices, with what
 * the customer typed last time (e.g. the same player ID). Products no longer
 * sold are skipped; a sensitive input is never echoed back, so a product that
 * had one is returned for the customer to fill in on its page.
 */
export async function reorder(
  order: Order,
  currency: string,
): Promise<{ added: number; unavailable: string[]; fillIn: string | null }> {
  let added = 0;
  const unavailable: string[] = [];
  let fillIn: string | null = null;

  for (const it of order.items) {
    const product = await catalog.product(it.productId, currency).catch(() => null);
    if (!product || product.isActive === false || product.inStock === false) {
      unavailable.push(
        getLang() === 'ar' ? it.productNameAr || it.productNameEn : it.productNameEn || it.productNameAr,
      );
      continue;
    }
    const inputs = it.inputs ?? [];
    if (inputs.some((i) => i.value === MASKED)) {
      fillIn ??= product.id;
      continue;
    }
    cart.add({
      productId: product.id,
      sku: product.sku,
      nameAr: product.nameAr || product.nameEn,
      imageUrl: product.imageUrl,
      unitPrice: product.sellPrice,
      currency: product.currency,
      quantity: it.quantity,
      gameId: product.gameId,
      delivery: product.delivery,
      maxPerOrder: product.maxPerOrder,
      inputs: inputs.map((i) => ({ key: i.fieldKey, value: i.value })),
    });
    added++;
  }
  return { added, unavailable, fillIn };
}
