'use client';

import Link from 'next/link';
import { LANGS, setLang, useLang, useT } from '@/lib/i18n';
import { BoltIcon, ShieldIcon, HeadsetIcon } from './icons';

export default function Footer() {
  const t = useT();
  const lang = useLang();
  return (
    <footer className="mt-20 border-t border-[rgb(var(--line))] bg-[rgb(var(--surface))]">
      <div className="mx-auto grid max-w-page gap-8 px-4 py-12 md:grid-cols-3">
        <div className="flex items-start gap-3">
          <BoltIcon className="mt-0.5 text-teal" />
          <div>
            <div className="font-bold">{t('تسليم فوري')}</div>
            <p className="mt-1 text-sm text-muted">{t('تصلك الأكواد مباشرة بعد إتمام الدفع.')}</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <ShieldIcon className="mt-0.5 text-teal" />
          <div>
            <div className="font-bold">{t('دفع آمن')}</div>
            <p className="mt-1 text-sm text-muted">{t('بياناتك محميّة ومعاملاتك مشفّرة.')}</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <HeadsetIcon className="mt-0.5 text-teal" />
          <div>
            <div className="font-bold">{t('دعم قريب منك')}</div>
            <p className="mt-1 text-sm text-muted">{t('مساعدة سريعة عند أي استفسار.')}</p>
          </div>
        </div>
      </div>
      <div className="border-t border-[rgb(var(--line))]">
        <div className="mx-auto flex max-w-page flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-muted sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-teal-soft to-teal text-[13px] font-extrabold text-teal-ink">
              P
            </span>
            <span dir="ltr" className="font-bold text-[rgb(var(--text))]">
              patron<span className="text-gold">.</span>
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <Link href="/products" className="hover:text-[rgb(var(--text))]">
              {t('المنتجات')}
            </Link>
            <Link href="/orders" className="hover:text-[rgb(var(--text))]">
              {t('طلباتي')}
            </Link>
            <Link href="/help" className="hover:text-[rgb(var(--text))]">
              {t('كيف أشتري؟')}
            </Link>
            <Link href="/terms" className="hover:text-[rgb(var(--text))]">
              {t('الشروط والاسترجاع')}
            </Link>
            <span>© {new Date().getFullYear()}</span>
          </div>
          {/* each language in its own name */}
          <div role="group" aria-label={t('اللغة')} className="flex items-center gap-1">
            {LANGS.map((l) => (
              <button
                key={l.id}
                lang={l.id}
                onClick={() => l.id !== lang && setLang(l.id)}
                aria-pressed={l.id === lang}
                className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                  l.id === lang ? 'bg-teal/10 text-teal' : 'hover:text-[rgb(var(--text))]'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
