'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ProductForm from '@/components/ProductForm';

export default function NewProductPage() {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/products" className="text-sm font-semibold text-muted hover:text-[rgb(var(--text))]">
          ← المنتجات
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold">منتج جديد</h1>
        <p className="mt-1 text-sm text-muted">يظهر في المتجر فور الحفظ إذا كان «ظاهرًا».</p>
      </div>
      <ProductForm onSaved={() => router.push('/products?saved=1')} />
    </div>
  );
}
