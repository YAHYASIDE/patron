'use client';

import { ApiError, catalog } from './api';
import { cart } from './cart';

/**
 * A cart is kept in the browser, so it can hold a product the shop has since
 * hidden or removed. Such a line must never block the order: it is taken out
 * and the customer is told which one, the next time a page shows the notice.
 */

const KEY = 'patron_cart_removed';

function remember(names: string[]) {
  if (!names.length) return;
  try {
    const before = JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as string[];
    sessionStorage.setItem(KEY, JSON.stringify([...new Set([...before, ...names])]));
  } catch {
    /* the cart is still fixed; only the notice is lost */
  }
}

/** Names of products taken out of the cart since the last call, then forgotten. */
export function takeRemovedNotice(): string[] {
  try {
    const names = JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as string[];
    sessionStorage.removeItem(KEY);
    return Array.isArray(names) ? names : [];
  } catch {
    return [];
  }
}

/** Take every line of one product out of the cart; returns its name. */
export function removeProduct(productId: string, name?: string | null): string {
  const lines = cart.items().filter((i) => i.productId === productId);
  for (const line of lines) cart.remove(cart.keyOf(line));
  const label = name || lines[0]?.nameAr || '';
  if (label) remember([label]);
  return label;
}

/** The catalog no longer has it (hidden or deleted); a network problem is not that. */
export const isGone = (err: unknown) => err instanceof ApiError && err.status === 404;

/** Check every product in the cart once; drop the ones the shop no longer sells. */
export async function dropUnavailable(): Promise<string[]> {
  const ids = [...new Set(cart.items().map((i) => i.productId))];
  const gone = await Promise.all(
    ids.map((id) =>
      catalog
        .product(id)
        .then(() => null)
        .catch((err) => (isGone(err) ? id : null)),
    ),
  );
  // another part of the page may have taken a line out first; its name is in the notice store then
  return gone.filter((id): id is string => !!id).map((id) => removeProduct(id)).filter(Boolean);
}
