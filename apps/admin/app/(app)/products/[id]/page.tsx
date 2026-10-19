'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import ProductForm, { type ProductInput } from '@/components/ProductForm';
import CodeStock from '@/components/CodeStock';

export default function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const list = useFetch<ProductInput>(`/admin/catalog/products/${id}`);
  const product = list.data;
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    if (!confirm('حذف هذا المنتج نهائيًّا من المتجر؟')) return;
    setDeleting(true);
    setError(null);
    try {
      await api.del(`/admin/catalog/products/${id}`);
      router.push('/products');
    } catch (err) {
      setError(
        err instanceof ApiError && /being fulfilled/i.test(err.message)
          ? 'لا يمكن الحذف: توجد طلبات لهذا المنتج قيد التنفيذ.'
          : err instanceof ApiError
            ? err.message
            : 'تعذّر الحذف.',
      );
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/products" className="text-sm font-semibold text-muted hover:text-[rgb(var(--text))]">
            ← المنتجات
          </Link>
          <h1 className="mt-2 text-2xl font-extrabold">{product ? product.nameAr : 'تعديل منتج'}</h1>
        </div>
        {product && (
          <button
            onClick={onDelete}
            disabled={deleting}
            className="rounded-xl border border-bad/40 px-4 py-2 text-sm font-bold text-bad transition hover:bg-bad/10 disabled:opacity-60"
          >
            {deleting ? 'جارٍ الحذف…' : 'حذف المنتج'}
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">{error}</div>
      )}
      {list.loading && <p className="text-sm text-muted">جارٍ التحميل…</p>}
      {list.error && <p className="text-sm text-bad">{list.error}</p>}
      {!list.loading && !list.error && !product && <p className="text-sm text-muted">المنتج غير موجود.</p>}

      {product?.id && <CodeStock productId={product.id} />}

      {product && (
        <ProductForm
          key={product.id}
          initial={{
            ...product,
            gameId: product.gameId ?? '',
            description: product.description ?? '',
            imageUrl: product.imageUrl ?? '',
          }}
          onSaved={() => router.push('/products?saved=1')}
        />
      )}
    </div>
  );
}
