'use client';

import { useCallback, useEffect, useState } from 'react';
import Notice from '@/components/Notice';
import { Chip, ConfirmDialog, Empty, Sheet, Skeleton } from '@/components/IntelBits';
import {
  money, suppliers, type CatalogOffer, type ProductHit, type SupplierLink, type SupplierStatus,
} from '@/lib/suppliers';

const errText = (e: unknown) => (e instanceof Error ? e.message : 'حدث خطأ. حاول مجددا.');

/**
 * «المورّدون»: connect a supplier account (GamesDrop), see its balance and
 * today's spend, link each product to the supplier's offer with the most it
 * may cost, and switch automatic delivery on per product. Linking never buys
 * anything; automatic delivery is off until the owner switches it on.
 */
export default function SuppliersPage() {
  const [status, setStatus] = useState<SupplierStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await suppliers.list();
      const gd = rows.find((r) => r.code === 'gamesdrop');
      setStatus(gd ? await suppliers.status(gd.id) : null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">المورّدون</h1>
        <p className="mt-1 text-sm text-muted">
          اربط منتجاتك بمورّد يسلّمها للزبون تلقائيًا بعد تأكيد الدفع. الربط لا يشتري شيئًا، والتسليم التلقائي مطفأ حتى تفعّله لكل
          منتج.
        </p>
      </div>

      {error && <Notice text={error} />}
      {loading && !status && <Skeleton rows={2} h="h-32" />}
      {!loading && !status && !error && <ConnectCard onDone={setStatus} />}
      {status && (
        <>
          <StatusCard s={status} onChange={setStatus} />
          <LinksSection providerId={status.id} active={status.isActive} />
        </>
      )}
    </div>
  );
}

// ─── connect ───

function ConnectCard({ onDone, reconnect = false }: { onDone: (s: SupplierStatus) => void; reconnect?: boolean }) {
  const [token, setToken] = useState('');
  const [limit, setLimit] = useState('20');
  const [alert, setAlert] = useState('10');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const s = await suppliers.connect({
        code: 'gamesdrop',
        apiKey: token.trim(),
        countryCode: 'MR',
        ...(limit.trim() && { dailyLimit: Number(limit) }),
        ...(alert.trim() && { lowBalanceAlert: Number(alert) }),
      });
      setToken('');
      onDone(s);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-lg font-extrabold">{reconnect ? 'تغيير مفتاح GamesDrop' : 'ربط حساب GamesDrop'}</h2>
        <ol className="mt-2 list-decimal space-y-1 ps-5 text-sm text-muted">
          <li>
            افتح حسابك التجاري في <bdi dir="ltr">gamesdrop.io</bdi> ثم أنشئ متجرًا (Create store).
          </li>
          <li>انسخ المفتاح (Shop Token) الذي يظهر لك والصقه هنا. يُحفظ مشفّرًا ولا يظهر مرة أخرى.</li>
          <li>اشحن رصيدًا صغيرًا في حسابهم للتجربة.</li>
        </ol>
      </div>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        مفتاح المتجر (Shop Token)
        <input
          type="password"
          autoComplete="off"
          dir="ltr"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="min-h-11 rounded-xl border border-line bg-transparent px-3"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField label="حد الصرف اليومي (بعملة المورّد)" value={limit} onChange={setLimit} hint="بعده يتوقف الشراء التلقائي حتى الغد." />
        <NumberField label="نبّهني إذا قلّ الرصيد عن" value={alert} onChange={setAlert} hint="يصلك تنبيه في الجرس." />
      </div>
      {err && <Notice text={err} />}
      <button
        disabled={busy || token.trim().length < 8}
        onClick={save}
        className="min-h-11 rounded-xl bg-teal px-5 font-bold text-white transition hover:bg-teal-deep disabled:opacity-50 sm:self-start"
      >
        {busy ? 'جار الربط…' : 'ربط الحساب'}
      </button>
    </section>
  );
}

function NumberField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-semibold">
      {label}
      <input
        inputMode="decimal"
        dir="ltr"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
        className="min-h-11 rounded-xl border border-line bg-transparent px-3"
      />
      {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
    </label>
  );
}

// ─── status ───

function StatusCard({ s, onChange }: { s: SupplierStatus; onChange: (s: SupplierStatus) => void }) {
  const [rekey, setRekey] = useState(false);
  const [test, setTest] = useState<{ busy: boolean; text?: string; ok?: boolean }>({ busy: false });
  const [toggling, setToggling] = useState(false);
  const cur = s.balance?.currency ?? '';
  const low = s.balance && s.lowBalanceAlert !== null && s.balance.balance < s.lowBalanceAlert;

  async function runTest() {
    setTest({ busy: true });
    try {
      const r = await suppliers.testOrder(s.id);
      setTest({
        busy: false,
        ok: r.ok,
        text: r.ok ? `نجح الطلب التجريبي (${r.status === 'DELIVERED' ? 'تم التسليم' : 'قيد التنفيذ'}). الربط يعمل.` : `فشل الطلب التجريبي: ${r.message ?? r.error}`,
      });
    } catch (e) {
      setTest({ busy: false, ok: false, text: errText(e) });
    }
  }

  async function toggle() {
    setToggling(true);
    try {
      onChange(await suppliers.limits(s.id, { isActive: !s.isActive }));
    } finally {
      setToggling(false);
    }
  }

  return (
    <section className="surface flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-extrabold">GamesDrop</h2>
          {s.connected ? <Chip label="متصل" cls="bg-ok/12 text-ok" /> : <Chip label="غير متصل" cls="bg-bad/10 text-bad" />}
          {!s.isActive && <Chip label="موقوف" cls="bg-ink-400/15 text-muted" />}
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={toggle} disabled={toggling} className="min-h-10 rounded-xl border border-line px-4 text-sm font-bold">
            {s.isActive ? 'إيقاف المورّد' : 'تشغيل المورّد'}
          </button>
          <button onClick={() => setRekey(true)} className="min-h-10 rounded-xl border border-line px-4 text-sm font-bold">
            تغيير المفتاح
          </button>
        </div>
      </div>

      {!s.connected && (
        <Notice text="GamesDrop لم يقبل المفتاح أو لا يرد الآن. تأكد من المفتاح ثم أعد الربط." />
      )}

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Fact k="الرصيد" v={s.balance ? money(s.balance.balance, cur) : '—'} warn={!!low} />
        <Fact k="صُرف اليوم" v={money(s.spentToday, cur)} />
        <Fact k="حد الصرف اليومي" v={s.dailyLimit === null ? 'بلا حد' : money(s.dailyLimit, cur)} />
        <Fact k="منتجات مربوطة" v={String(s.linkedProducts)} />
      </dl>
      {low && <p className="rounded-lg bg-warn/10 px-3 py-2 text-sm font-semibold text-warn">الرصيد منخفض: اشحن حسابك عند GamesDrop.</p>}

      <div className="flex flex-col gap-2 rounded-xl bg-ink-400/5 p-3 text-sm">
        <p>
          <b>طلب تجريبي:</b> يستخدم المنتج التجريبي الذي يوفّره GamesDrop للاختبار، فلا يُشترى منتج حقيقي. استعمله بعد الربط
          للتأكد أن كل شيء يعمل.
        </p>
        <button
          onClick={runTest}
          disabled={test.busy || !s.connected}
          className="min-h-10 rounded-xl bg-teal px-4 font-bold text-white disabled:opacity-50 sm:self-start"
        >
          {test.busy ? 'جار التجربة…' : 'جرّب الربط'}
        </button>
        {test.text && <p className={test.ok ? 'font-semibold text-ok' : 'font-semibold text-bad'}>{test.text}</p>}
      </div>

      {rekey && (
        <Sheet title="تغيير مفتاح GamesDrop" onClose={() => setRekey(false)}>
          <ConnectCard
            reconnect
            onDone={(n) => {
              setRekey(false);
              onChange(n);
            }}
          />
        </Sheet>
      )}
    </section>
  );
}

function Fact({ k, v, warn = false }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl bg-ink-400/5 p-3">
      <dt className="text-[11px] text-muted">{k}</dt>
      <dd className={`mt-0.5 font-extrabold ${warn ? 'text-warn' : ''}`} dir="ltr" style={{ textAlign: 'right' }}>
        {v}
      </dd>
    </div>
  );
}

// ─── links ───

function LinksSection({ providerId, active }: { providerId: string; active: boolean }) {
  const [links, setLinks] = useState<SupplierLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<SupplierLink | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLinks(await suppliers.links(providerId));
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, [providerId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setAuto(l: SupplierLink, enabled: boolean) {
    setBusyId(l.id);
    try {
      await suppliers.auto(l.id, enabled);
      await load();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusyId(null);
      setConfirm(null);
    }
  }

  async function unlink(l: SupplierLink) {
    setBusyId(l.id);
    try {
      await suppliers.unlink(l.id);
      await load();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-extrabold">المنتجات المربوطة</h2>
        <button
          onClick={() => setAdding(true)}
          className="min-h-11 w-full rounded-xl bg-teal px-5 text-sm font-bold text-white sm:w-auto"
        >
          + ربط منتج
        </button>
      </div>
      {error && <Notice text={error} />}
      {!links && !error && <Skeleton rows={2} />}
      {links && links.length === 0 && <Empty>لم تربط أي منتج بعد. اضغط «ربط منتج» وابحث عن العرض في كتالوج GamesDrop.</Empty>}

      <ul className="flex flex-col gap-2">
        {links?.map((l) => (
          <li key={l.id} className="surface flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-bold">{l.productName}</p>
              <p className="text-xs text-muted" dir="ltr" style={{ textAlign: 'right' }}>
                {l.productSku} ← GamesDrop #{l.providerSku}
              </p>
              <p className="mt-1 text-sm">
                البيع {money(l.sellPrice, l.sellCurrency)} · التكلفة القصوى {money(l.providerCost, l.providerCurrency)}
                {l.margin !== null && (
                  <b className={l.margin > 0 ? ' text-ok' : ' text-bad'}> · الربح {money(l.margin, l.sellCurrency)}</b>
                )}
              </p>
              {l.margin !== null && l.margin <= 0 && <p className="text-xs font-semibold text-bad">سعر البيع لا يغطي التكلفة.</p>}
              {l.margin === null && <p className="text-xs text-muted">عملة البيع تختلف عن عملة المورّد: راجع الربح بنفسك.</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {l.autoDelivery ? <Chip label="تسليم تلقائي" cls="bg-ok/12 text-ok" /> : <Chip label="تسليم يدوي" cls="bg-ink-400/15 text-muted" />}
              <button
                disabled={busyId === l.id || (!l.autoDelivery && !active)}
                onClick={() => (l.autoDelivery ? setAuto(l, false) : setConfirm(l))}
                className="min-h-10 rounded-xl border border-line px-3 text-sm font-bold disabled:opacity-50"
              >
                {l.autoDelivery ? 'إيقاف التلقائي' : 'تفعيل التلقائي'}
              </button>
              <button
                disabled={busyId === l.id}
                onClick={() => unlink(l)}
                className="min-h-10 rounded-xl px-3 text-sm font-bold text-bad disabled:opacity-50"
              >
                إلغاء الربط
              </button>
            </div>
          </li>
        ))}
      </ul>

      {adding && (
        <LinkSheet
          providerId={providerId}
          onClose={() => setAdding(false)}
          onLinked={() => {
            setAdding(false);
            void load();
          }}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title="تفعيل التسليم التلقائي؟"
          body={
            <>
              بعد تأكيد دفع الزبون سيشتري المتجر «{confirm.productName}» من GamesDrop ويسلّمه تلقائيًا، بسعر لا يتجاوز{' '}
              {money(confirm.providerCost, confirm.providerCurrency)}. إذا ارتفع سعر المورّد أو بلغت حد الصرف اليومي يتحول الطلب
              إلى التسليم اليدوي.
            </>
          }
          confirmLabel="تفعيل"
          busy={busyId === confirm.id}
          onConfirm={() => setAuto(confirm, true)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </section>
  );
}

function LinkSheet({ providerId, onClose, onLinked }: { providerId: string; onClose: () => void; onLinked: () => void }) {
  const [q, setQ] = useState('');
  const [offers, setOffers] = useState<CatalogOffer[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [offer, setOffer] = useState<CatalogOffer | null>(null);
  const [pq, setPq] = useState('');
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [product, setProduct] = useState<ProductHit | null>(null);
  const [cost, setCost] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function search() {
    setSearching(true);
    setErr(null);
    try {
      setOffers((await suppliers.catalog(providerId, q)).offers);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setSearching(false);
    }
  }

  useEffect(() => {
    if (pq.trim().length < 2) return setHits([]);
    const t = setTimeout(() => {
      suppliers.products(pq).then((r) => setHits(r.data), () => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [pq]);

  async function save() {
    if (!offer || !product) return;
    setBusy(true);
    setErr(null);
    try {
      await suppliers.link(providerId, { productId: product.id, providerSku: offer.sku, providerCost: Number(cost) });
      onLinked();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      wide
      title="ربط منتج بعرض من GamesDrop"
      subtitle="الربط لا يشتري شيئًا. التسليم يبقى يدويًا حتى تفعّله."
      onClose={onClose}
      footer={
        <button
          disabled={!offer || !product || !(Number(cost) > 0) || busy}
          onClick={save}
          className="min-h-11 w-full rounded-xl bg-teal font-bold text-white disabled:opacity-50"
        >
          {busy ? 'جار الحفظ…' : 'حفظ الربط'}
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-bold">1. ابحث عن العرض عند GamesDrop</p>
          <div className="flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
              placeholder="PUBG، Free Fire، Steam…"
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-transparent px-3"
            />
            <button onClick={search} disabled={searching} className="min-h-11 rounded-xl bg-teal px-4 font-bold text-white">
              {searching ? '…' : 'بحث'}
            </button>
          </div>
          {offers && offers.length === 0 && <Empty>لا نتائج.</Empty>}
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {offers?.map((o) => (
              <li key={o.sku}>
                <button
                  disabled={!!o.linkedProductId || !o.inStock || o.countryCompatibility === 'blocked'}
                  onClick={() => {
                    setOffer(o);
                    setCost(String(o.price));
                  }}
                  className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-start disabled:opacity-50 ${
                    offer?.sku === o.sku ? 'border-teal bg-teal/5' : 'border-line'
                  }`}
                >
                  <span className="min-w-0" dir="ltr">
                    <b>{o.productName}</b> · {o.offerName}
                  </span>
                  <span className="flex flex-wrap items-center gap-1 text-sm">
                    <b dir="ltr">{money(o.price, o.currency)}</b>
                    {o.needsPlayerId && <Chip label="شحن مباشر برقم اللاعب" cls="bg-teal/10 text-teal" />}
                    {!o.inStock && <Chip label="نفد" cls="bg-bad/10 text-bad" />}
                    {o.countryCompatibility === 'blocked' && <Chip label="لا يعمل في بلدك" cls="bg-bad/10 text-bad" />}
                    {o.linkedProductId && <Chip label="مربوط" cls="bg-ink-400/15 text-muted" />}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {offer && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-bold">2. اختر منتجك في المتجر</p>
            {product ? (
              <div className="flex items-center justify-between rounded-xl border border-teal p-3">
                <span>{product.nameAr}</span>
                <button onClick={() => setProduct(null)} className="text-sm font-bold text-teal">
                  تغيير
                </button>
              </div>
            ) : (
              <>
                <input
                  value={pq}
                  onChange={(e) => setPq(e.target.value)}
                  placeholder="اسم المنتج أو رمزه"
                  className="min-h-11 rounded-xl border border-line bg-transparent px-3"
                />
                <ul className="flex flex-col gap-1">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <button onClick={() => setProduct(h)} className="w-full rounded-xl border border-line p-3 text-start">
                        {h.nameAr} <span className="text-xs text-muted" dir="ltr">{h.sku}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {offer && product && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-bold">3. أقصى سعر تقبل أن تدفعه للمورّد</p>
            <NumberField
              label={`بعملة GamesDrop (${offer.currency})`}
              value={cost}
              onChange={setCost}
              hint={`السعر الآن ${money(offer.price, offer.currency)}. إذا ارتفع فوق هذا الرقم لن يُشترى المنتج تلقائيًا.`}
            />
          </div>
        )}
        {err && <Notice text={err} />}
      </div>
    </Sheet>
  );
}
