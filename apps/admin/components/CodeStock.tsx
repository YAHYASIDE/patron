'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { date } from '@/lib/format';

type Summary = {
  available: number;
  used: number;
  expired: number;
  recent: { id: string; masked: string; isUsed: boolean; createdAt: string; expiresAt: string | null }[];
};

/**
 * The product's codes in stock. Paste codes bought in advance (one per line):
 * a paid order then receives them at once, with no one at the dashboard.
 */
export default function CodeStock({ productId }: { productId: string }) {
  const stock = useFetch<Summary>(`/admin/catalog/products/${productId}/codes`);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const data = summary ?? stock.data;
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  async function upload() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.post<Summary & { added: number; duplicates: number }>(
        `/admin/catalog/products/${productId}/codes`,
        { codes: lines },
      );
      setSummary(res);
      setText('');
      setMsg({
        ok: true,
        text: `أُضيف ${res.added} كود${res.duplicates ? ` · تُجوهل ${res.duplicates} مكرّر أو موجود مسبقًا` : ''}.`,
      });
    } catch (e) {
      setMsg({
        ok: false,
        text:
          e instanceof ApiError && e.status === 403
            ? 'ليست لديك صلاحية إدارة الأكواد.'
            : 'تعذّر رفع الأكواد.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function remove(codeId: string) {
    if (!confirm('حذف هذا الكود من المخزون؟')) return;
    try {
      setSummary(await api.del<Summary>(`/admin/catalog/products/${productId}/codes/${codeId}`));
    } catch {
      setMsg({ ok: false, text: 'تعذّر الحذف.' });
    }
  }

  return (
    <section className="surface rounded-2xl p-5 shadow-card">
      <h2 className="text-base font-bold">أكواد المخزون</h2>
      <p className="mt-1 text-sm text-muted">
        الصق الأكواد التي اشتريتها مسبقًا، كل كود في سطر. عند تأكيد دفع أي طلب لهذا المنتج يُسلَّم الكود
        للزبون فورًا، بلا انتظار. إن نفدت الأكواد تسلّمه أنت يدويًا كالمعتاد.
      </p>

      {data && (
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <Stat label="متوفّر" value={data.available} tone={data.available > 0 ? 'ok' : 'warn'} />
          <Stat label="مُباع" value={data.used} />
          <Stat label="منتهي" value={data.expired} />
        </div>
      )}

      <textarea
        dir="ltr"
        rows={5}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setMsg(null);
        }}
        placeholder={'XXXX-XXXX-XXXX\nYYYY-YYYY-YYYY'}
        className="surface-2 hairline mt-4 w-full rounded-xl border px-3.5 py-2.5 font-mono text-[15px] outline-none focus:border-teal"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-xs text-muted">
          {lines.length ? `${lines.length} كود جاهز للرفع` : 'لا يُقبل الكود نفسه مرتين.'}
        </span>
        <button
          onClick={upload}
          disabled={busy || lines.length === 0}
          className="rounded-xl bg-teal px-5 py-2.5 text-sm font-bold text-white transition hover:bg-teal-deep disabled:opacity-50"
        >
          {busy ? 'جارٍ الرفع…' : 'أضف إلى المخزون'}
        </button>
      </div>
      {msg && <p className={`mt-3 text-sm font-semibold ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p>}

      {data && data.recent.length > 0 && (
        <div className="mt-5">
          <div className="text-xs font-semibold text-muted">آخر الأكواد (مخفية جزئيًا)</div>
          <ul className="mt-2 flex flex-col gap-1.5">
            {data.recent.map((c) => (
              <li
                key={c.id}
                className="surface-2 flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm"
              >
                <span dir="ltr" className="font-mono">
                  {c.masked}
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-xs text-muted">
                    {c.isUsed ? 'مُباع' : `أُضيف ${date(c.createdAt)}`}
                  </span>
                  {!c.isUsed && (
                    <button
                      onClick={() => remove(c.id)}
                      className="text-xs font-bold text-bad hover:underline"
                    >
                      حذف
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'warn' }) {
  return (
    <div className="surface-2 rounded-xl py-3">
      <div
        className={`tnum text-2xl font-extrabold ${tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : ''}`}
      >
        {value}
      </div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
