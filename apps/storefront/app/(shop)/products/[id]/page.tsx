'use client';

import { use } from 'react';
import BrandPage from '@/components/BrandPage';

/** A product link (by id or SKU) opens its brand page with that denomination selected. */
export default function ProductRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <BrandPage productRef={decodeURIComponent(id)} />;
}
