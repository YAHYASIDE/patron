'use client';

import { use } from 'react';
import BrandPage from '@/components/BrandPage';

export default function BrandRoute({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  return <BrandPage brandKey={decodeURIComponent(key)} />;
}
