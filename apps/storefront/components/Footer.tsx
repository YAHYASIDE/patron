import Link from 'next/link';
import { BoltIcon, ShieldIcon, HeadsetIcon } from './icons';

export default function Footer() {
  return (
    <footer className="mt-20 border-t border-[rgb(var(--line))] bg-[rgb(var(--surface))]">
      <div className="mx-auto grid max-w-page gap-8 px-4 py-12 md:grid-cols-3">
        <div className="flex items-start gap-3">
          <BoltIcon className="mt-0.5 text-teal" />
          <div>
            <div className="font-bold">تسليم فوري</div>
            <p className="mt-1 text-sm text-muted">تصلك الأكواد مباشرة بعد إتمام الدفع.</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <ShieldIcon className="mt-0.5 text-teal" />
          <div>
            <div className="font-bold">دفع آمن</div>
            <p className="mt-1 text-sm text-muted">بياناتك محميّة ومعاملاتك مشفّرة.</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <HeadsetIcon className="mt-0.5 text-teal" />
          <div>
            <div className="font-bold">دعم قريب منك</div>
            <p className="mt-1 text-sm text-muted">مساعدة سريعة عند أي استفسار.</p>
          </div>
        </div>
      </div>
      <div className="border-t border-[rgb(var(--line))]">
        <div className="mx-auto flex max-w-page flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-muted sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-teal-soft to-teal text-[13px] font-extrabold text-teal-ink">
              P
            </span>
            <span className="font-bold text-[rgb(var(--text))]">
              باترون<span className="text-gold">.</span>
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <Link href="/products" className="hover:text-[rgb(var(--text))]">
              المنتجات
            </Link>
            <Link href="/orders" className="hover:text-[rgb(var(--text))]">
              طلباتي
            </Link>
            <Link href="/help" className="hover:text-[rgb(var(--text))]">
              كيف أشتري؟
            </Link>
            <Link href="/terms" className="hover:text-[rgb(var(--text))]">
              الشروط والاسترجاع
            </Link>
            <span>© {new Date().getFullYear()}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
