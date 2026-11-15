'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { dateTime } from '@/lib/format';
import Notice from '@/components/Notice';

type Entry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: { fullName: string; email: string | null } | null;
  createdAt: string;
};
type Page = { data: Entry[]; nextCursor: string | null };

// what the owner reads instead of the API's action keys
const ACTIONS: Record<string, string> = {
  'banners.create': 'أضاف عرضًا',
  'banners.update': 'عدّل عرضًا',
  'banners.delete': 'حذف عرضًا',
  'catalog.codes.add': 'أضاف أكوادًا للمخزون',
  'catalog.codes.remove': 'حذف كودًا من المخزون',
  'orders.cancel': 'ألغى طلبًا',
  'orders.deliver_from_stock': 'سلّم طلبًا من المخزون',
  'orders.fulfil_manual': 'سلّم طلبًا يدويًا',
  'orders.reveal_result': 'كُشف كود لزبون',
  'orders.note': 'كتب ملاحظة على طلب',
  'payments.manual.approve': 'أكّد دفعة تحويل',
  'payments.manual.reject': 'رفض دفعة تحويل',
  'payments.manual_accounts.update': 'عدّل وسائل الدفع',
  'payments.refund': 'استرجع مبلغًا',
  'providers.rotate_key': 'غيّر مفتاح مورّد',
  'roles.create': 'أنشأ دورًا',
  'roles.update': 'عدّل دورًا',
  'roles.delete': 'حذف دورًا',
  'shop.info.update': 'عدّل معلومات المتجر',
  'shop.templates.update': 'عدّل ردود واتساب',
  'users.create': 'أنشأ حسابًا',
  'users.update': 'عدّل حسابًا',
  'users.delete': 'حذف حسابًا',
  'users.block': 'أوقف حسابًا',
  'wallet.adjust': 'عدّل رصيد محفظة',
  'auth.login': 'سجّل الدخول',
  'auth.code_relayed': 'أرسل رمز تحقق',
  'auth.phone_verified': 'وُثّق رقم زبون',
  'auth.register': 'سجّل حساب جديد',
  'auth.register_phone': 'سجّل زبون برقمه',
  'auth.password_change': 'غيّر كلمة المرور',
  'auth.password_reset': 'أعاد تعيين كلمة المرور',
  'product.create': 'أضاف منتجًا',
  'product.update': 'عدّل منتجًا',
  'product.delete': 'حذف منتجًا',
  'product.clone': 'نسخ منتجًا',
  'product.bulk_price': 'عدّل الأسعار جماعيًا',
  'coupons.create': 'أنشأ قسيمة',
  'coupons.update': 'عدّل قسيمة',
  'reviews.update': 'عدّل تقييمًا',
  'support.reply': 'ردّ على طلب دعم',
  'support.update': 'عدّل طلب دعم',
  'notifications.broadcast': 'أرسل رسالة للزبائن',
  'customers.update': 'عدّل ملف زبون',
  'backup.download': 'نزّل نسخة احتياطية',
};

const ENTITIES: { key: string; label: string }[] = [
  { key: '', label: 'الكل' },
  { key: 'Order', label: 'الطلبات' },
  { key: 'Payment', label: 'المدفوعات' },
  { key: 'Product', label: 'المنتجات' },
  { key: 'User', label: 'الحسابات' },
  { key: 'Banner', label: 'العروض' },
  { key: 'Coupon', label: 'القسائم' },
  { key: 'SystemSetting', label: 'الإعدادات' },
];

const ENTITY_LABEL: Record<string, string> = {
  Order: 'طلب',
  OrderItem: 'منتج في طلب',
  Payment: 'دفعة',
  Product: 'منتج',
  User: 'حساب',
  Banner: 'عرض',
  Coupon: 'قسيمة',
  SystemSetting: 'إعداد',
  Category: 'فئة',
  Game: 'لعبة',
  Role: 'دور',
  Refund: 'استرجاع',
  Review: 'تقييم',
  SupportTicket: 'طلب دعم',
  VerificationToken: 'رمز تحقق',
  Provider: 'مورّد',
};

function linkOf(e: Entry): string | null {
  if (!e.entityId) return null;
  switch (e.entityType) {
    case 'Order':
      return `/orders/${e.entityId}`;
    case 'Product':
      return `/products/${e.entityId}`;
    case 'User':
      return `/customers/${e.entityId}`;
    case 'Banner':
      return '/banners';
    case 'Coupon':
      return '/coupons';
    case 'Review':
      return '/reviews';
    case 'SupportTicket':
      return '/support';
    default:
      return null;
  }
}

/** Who changed what, newest first; more rows load as the owner scrolls. */
export default function ActivityPage() {
  const [entity, setEntity] = useState('');
  const [rows, setRows] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  const load = useCallback(
    async (next: string | null) => {
      if (busy.current) return;
      busy.current = true;
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ limit: '30' });
        if (next) qs.set('cursor', next);
        if (entity) qs.set('entityType', entity);
        const page = await api.get<Page>(`/admin/audit?${qs.toString()}`);
        setRows((r) => (next ? [...r, ...page.data] : page.data));
        setCursor(page.nextCursor);
        setDone(!page.nextCursor);
      } catch (e) {
        setError(
          e instanceof ApiError
            ? e.status === 403
              ? 'ليست لديك صلاحية سجل النشاط.'
              : e.message
            : 'تعذّر الجلب.',
        );
        setDone(true);
        if (!next) setRows([]);
      } finally {
        busy.current = false;
        setLoading(false);
      }
    },
    [entity],
  );

  useEffect(() => {
    setDone(false);
    load(null);
  }, [load]);

  // load the next page when the end of the list scrolls into view
  useEffect(() => {
    const el = sentinel.current;
    if (!el || done) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && cursor) load(cursor);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, done, load]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">سجل النشاط</h1>
        <p className="mt-1 text-sm text-muted">من غيّر ماذا ومتى: الطلبات، الأسعار، الإعدادات، والحسابات.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {ENTITIES.map((f) => (
          <button
            key={f.key || 'all'}
            onClick={() => setEntity(f.key)}
            className={
              'rounded-full px-3.5 py-1.5 text-xs font-bold transition ' +
              (entity === f.key ? 'bg-teal text-white' : 'surface-2 text-muted hover:text-[rgb(var(--text))]')
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <Notice text={error} />}

      <section className="surface overflow-hidden rounded-2xl shadow-card">
        {loading && rows.length === 0 && (
          <p className="px-5 py-8 text-center text-sm text-muted">جارٍ التحميل…</p>
        )}
        {!loading && !error && rows.length === 0 && (
          <p className="px-5 py-8 text-center text-sm text-muted">لا نشاط مسجّل هنا.</p>
        )}
        <ol className="flex flex-col divide-y divide-[rgb(var(--line))]">
          {rows.map((e) => {
            const href = linkOf(e);
            const what = ENTITY_LABEL[e.entityType] ?? e.entityType;
            return (
              <li
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 text-sm"
              >
                <div className="min-w-0">
                  <div>
                    <span className="font-bold">{e.actor?.fullName ?? 'النظام'}</span>{' '}
                    <span>{ACTIONS[e.action] ?? e.action}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-2 text-xs text-muted">
                    {href ? (
                      <Link href={href} className="font-semibold text-teal hover:underline">
                        {what}
                      </Link>
                    ) : (
                      <span>{what}</span>
                    )}
                    {e.entityId && (
                      <span dir="ltr" className="font-mono">
                        {e.entityId.slice(0, 8)}
                      </span>
                    )}
                    {!ACTIONS[e.action] ? null : (
                      <span dir="ltr" className="font-mono opacity-70">
                        {e.action}
                      </span>
                    )}
                  </div>
                </div>
                <span className="whitespace-nowrap text-xs text-muted">{dateTime(e.createdAt)}</span>
              </li>
            );
          })}
        </ol>
      </section>

      <div ref={sentinel} className="flex items-center justify-center">
        {!done && rows.length > 0 && (
          <button
            disabled={loading}
            onClick={() => load(cursor)}
            className="rounded-xl border border-[rgb(var(--line))] px-5 py-2 text-sm font-semibold disabled:opacity-40"
          >
            {loading ? 'جارٍ…' : 'تحميل المزيد'}
          </button>
        )}
        {done && rows.length > 0 && <span className="text-xs text-muted">هذه بداية السجل.</span>}
      </div>
    </div>
  );
}
