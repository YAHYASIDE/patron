'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError, NOT_READY } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import ProductForm, { type ProductInput } from '@/components/ProductForm';
import CodeStock from '@/components/CodeStock';

export default function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const list = useFetch<ProductInput>(`/admin/catalog/products/${id}`);
  const product = list.data;
  const [deleting, setDeleting] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [copied, setCopied] = useState(false);

  // just made by "نسخ المنتج" (?copied=1)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('copied')) {
      setCopied(true);
      window.history.replaceState(null, '', `/products/${id}`);
    } else setCopied(false);
  }, [id]);
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

  // a copy is created hidden (inactive, no codes) with a "-COPY" SKU, then opened for editing
  async function onClone() {
    if (!confirm('إنشاء نسخة من هذا المنتج؟ تُنشأ موقوفة وبلا أكواد، لتعدّلها ثم تفعّلها.')) return;
    setCloning(true);
    setError(null);
    try {
      const copy = await api.post<{ id: string }>(`/admin/catalog/products/${id}/clone`);
      setCloning(false);
      router.push(`/products/${copy.id}?copied=1`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message === NOT_READY
            ? 'نسخ المنتج غير متاح بعد.'
            : err.status === 403
              ? 'ليست لديك صلاحية إضافة منتجات.'
              : err.message
          : 'تعذّر النسخ.',
      );
      setCloning(false);
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
          <div className="flex flex-wrap gap-2">
            <button
              onClick={onClone}
              disabled={cloning}
              className="rounded-xl border border-[rgb(var(--line))] px-4 py-2 text-sm font-bold transition hover:border-teal disabled:opacity-60"
            >
              {cloning ? 'جارٍ النسخ…' : 'نسخ المنتج'}
            </button>
            <button
              onClick={onDelete}
              disabled={deleting}
              className="rounded-xl border border-bad/40 px-4 py-2 text-sm font-bold text-bad transition hover:bg-bad/10 disabled:opacity-60"
            >
              {deleting ? 'جارٍ الحذف…' : 'حذف المنتج'}
            </button>
          </div>
        )}
      </div>

      {copied && (
        <div className="rounded-xl border border-ok/30 bg-ok/10 px-4 py-3 text-sm font-semibold text-ok">
          هذه نسخة جديدة، موقوفة وبلا أكواد. عدّل الاسم والسعر ثم فعّلها واحفظ.
        </div>
      )}
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
