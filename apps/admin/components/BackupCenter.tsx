'use client';

import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { dateTime, num } from '@/lib/format';
import ExportButton from '@/components/ExportButton';
import Notice from '@/components/Notice';
import {
  BackupOverview, BackupRun, BackupSchedule, bytes, disconnectDrive, downloadEncrypted, driveConsentUrl, MIN_PASSPHRASE,
  OVERVIEW_PATH, passphraseStrength, RUN_STATUS, RUNS_PATH, saveSchedule, sendToDriveNow, TABLE_LABEL, TRIGGER_LABEL,
  verifyBackup, VerifyResult, WEEKDAYS,
} from '@/lib/backup';

type Msg = { tone: 'ok' | 'bad' | 'warn'; text: string } | null;

const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

const inputCls =
  'surface-2 hairline w-full min-w-0 rounded-xl border px-3.5 py-2.5 text-[15px] outline-none transition focus:border-teal';
const primaryBtn =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-teal px-4 py-2 text-sm font-bold text-white transition hover:bg-teal-deep disabled:opacity-50';
const ghostBtn =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[rgb(var(--line))] px-4 py-2 text-sm font-bold transition hover:border-teal disabled:opacity-50';

/**
 * The backup section of the settings page: take a copy home (plain or locked
 * with a passphrase), send encrypted copies to Google Drive on a schedule, see
 * every attempt, and check that a file would restore.
 */
export default function BackupCenter() {
  const overview = useFetch<BackupOverview>(OVERVIEW_PATH);
  const runs = useFetch<BackupRun[]>(RUNS_PATH);
  const [returned, setReturned] = useState<Msg>(null);

  // back from Google's consent page: ?gdrive=connected | error&reason=…
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const g = q.get('gdrive');
    if (!g) return;
    const reason = q.get('reason');
    setReturned(
      g === 'connected'
        ? { tone: 'ok', text: 'تم ربط Google Drive. يمكنك الآن تشغيل النسخ المجدولة.' }
        : {
            tone: 'bad',
            text:
              reason === 'access_denied'
                ? 'لم يتم الربط: رفضت الإذن في صفحة Google.'
                : reason === 'GDRIVE_STATE_INVALID'
                  ? 'لم يتم الربط: انتهت صلاحية الرابط. أعد المحاولة.'
                  : 'لم يتم ربط Google Drive. أعد المحاولة، وتأكّد من إعدادات Google على الخادم.',
          },
    );
    q.delete('gdrive');
    q.delete('reason');
    const rest = q.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}#backup`);
    document.getElementById('backup')?.scrollIntoView();
  }, []);

  const refresh = () => {
    overview.reload();
    runs.reload();
  };
  const o = overview.data;

  return (
    <section id="backup" className="surface flex scroll-mt-20 flex-col gap-5 rounded-2xl border-warn/40 p-4 shadow-card sm:p-5">
      <div className="flex flex-col gap-2">
        <h2 className="text-base font-bold">النسخ الاحتياطي</h2>
        <div className="rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm leading-relaxed text-warn">
          <b>مهم:</b> قاعدة البيانات المجانية على Render تُحذف بعد نحو 30 يومًا من إنشائها، ومعها كل الزبائن والطلبات
          والمنتجات. احتفظ بنسخ احتياطية منتظمة (نزّلها أو فعّل النسخ التلقائي إلى Google Drive)، ورقِّ قاعدة البيانات
          إلى خطة مدفوعة.
        </div>
        <p className="text-sm text-muted">
          النسخة ملف واحد يُعاد منه بناء المتجر: الزبائن وأرصدة محافظهم بكل حركاتها، والطلبات والمدفوعات والاسترجاعات،
          والمنتجات والأسعار والقسائم، والمندوبون وعمولاتهم، وطلبات USDT، ومخزون الأكواد مشفّرًا كما هو محفوظ. لا تحتوي
          كلمات المرور ولا الصور المرفوعة. الأكواد لا تُفتح إلا بمفتاح التشفير (ENCRYPTION_KEY) الذي أنشأته عند النشر:
          احفظه في مكان آمن منفصل.
        </p>
        <p className="text-sm font-semibold">
          {overview.loading && !o
            ? '…'
            : o?.lastSuccessAt
              ? `آخر نسخة ناجحة: ${dateTime(o.lastSuccessAt)}`
              : o
                ? 'لم تُؤخذ أي نسخة احتياطية بعد.'
                : ''}
        </p>
        {overview.error && <Notice text={overview.error} />}
        {returned && <Notice text={returned.text} tone={returned.tone} />}
      </div>

      <Downloads onDone={refresh} />
      {o && <Drive o={o} onChange={refresh} />}
      {o && <Schedule o={o} onSaved={refresh} />}
      <History runs={runs.data} loading={runs.loading} error={runs.error} onReload={runs.reload} />
      <Verify />
    </section>
  );
}

function Block({ title, children, hint }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t hairline pt-4">
      <div>
        <h3 className="text-sm font-bold">{title}</h3>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

/** Plain download (as before) and the passphrase-locked one. */
function Downloads({ onDone }: { onDone: () => void }) {
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const strength = passphraseStrength(pass);
  const mismatch = confirm.length > 0 && confirm !== pass;
  const ready = [...pass].length >= MIN_PASSPHRASE && confirm === pass && ack && !busy;

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      await downloadEncrypted(pass);
      setMsg({ tone: 'ok', text: 'تم تنزيل النسخة المشفّرة. احفظ عبارة المرور في مكان آمن غير مكان الملف.' });
      setPass('');
      setConfirm('');
      setAck(false);
      onDone();
    } catch (e) {
      setMsg({ tone: 'bad', text: errText(e, 'تعذّر التنزيل.') });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Block
      title="تنزيل نسخة على جهازك"
      hint="النسخة المشفّرة مقفلة بعبارة مرور تختارها الآن: لا يفتحها أحد بدونها، ولو وقع الملف في يد غيرك."
    >
      <div className="flex flex-col gap-3 rounded-xl border hairline p-3 sm:p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            عبارة المرور
            <input
              type={show ? 'text' : 'password'}
              dir="auto"
              autoComplete="new-password"
              value={pass}
              onChange={(e) => {
                setPass(e.target.value);
                setMsg(null);
              }}
              placeholder={`${MIN_PASSPHRASE} حرفًا على الأقل، مثل جملة تحفظها`}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            أعد كتابتها
            <input
              type={show ? 'text' : 'password'}
              dir="auto"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputCls + (mismatch ? ' border-bad' : '')}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          {pass ? (
            <span className={`font-bold ${strength.cls}`}>
              القوة: {strength.label}
              <span className="ms-2 inline-flex gap-1 align-middle" aria-hidden>
                {[1, 2, 3].map((i) => (
                  <span key={i} className={`h-1.5 w-6 rounded-full ${strength.score >= i ? 'bg-current' : 'bg-[rgb(var(--line))]'}`} />
                ))}
              </span>
            </span>
          ) : (
            <span className="text-muted">جملة طويلة من كلمات عادية أقوى وأسهل حفظًا من رموز قصيرة.</span>
          )}
          <button type="button" onClick={() => setShow((s) => !s)} className="font-bold text-teal">
            {show ? 'إخفاء' : 'إظهار'}
          </button>
        </div>
        {mismatch && <p className="text-xs font-bold text-bad">العبارتان غير متطابقتين.</p>}
        <label className="flex items-start gap-2 rounded-xl border border-bad/30 bg-bad/5 px-3 py-2.5 text-xs leading-relaxed text-bad">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-current" />
          <span>
            <b>فهمت:</b> إن نسيت عبارة المرور فلا يمكن فتح هذه النسخة أبدًا، ولا يستطيع أحد استعادتها — لا نحن ولا الخادم.
            سأكتبها وأحفظها في مكان آمن بعيدًا عن الملف.
          </span>
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button type="button" onClick={run} disabled={!ready} className={primaryBtn}>
            <LockIcon />
            {busy ? 'جارٍ التشفير والتنزيل…' : 'تنزيل نسخة مشفّرة'}
          </button>
        </div>
        {msg && <Notice text={msg.text} tone={msg.tone} />}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-xs text-muted">أو نسخة غير مشفّرة (JSON): احفظها في مكان لا يصل إليه غيرك.</p>
        <div>
          <ExportButton
            path="/admin/backup"
            filename={`patron-backup-${new Date().toLocaleDateString('en-CA')}.json`}
            label="تنزيل نسخة غير مشفّرة"
            onDone={onDone}
          />
        </div>
      </div>
    </Block>
  );
}

/** Google Drive: what is missing on the server, connect/disconnect, send a copy now. */
function Drive({ o, onChange }: { o: BackupOverview; onChange: () => void }) {
  const [busy, setBusy] = useState<'' | 'connect' | 'disconnect' | 'run'>('');
  const [msg, setMsg] = useState<Msg>(null);
  const { drive, backupKey } = o;

  async function connect() {
    setBusy('connect');
    setMsg(null);
    try {
      window.location.href = await driveConsentUrl(`${window.location.origin}${window.location.pathname}`);
    } catch (e) {
      setMsg({ tone: 'bad', text: errText(e, 'تعذّر بدء الربط.') });
      setBusy('');
    }
  }

  async function disconnect() {
    if (!window.confirm('فصل Google Drive؟ تتوقف النسخ المجدولة، وتبقى النسخ الموجودة في Drive كما هي.')) return;
    setBusy('disconnect');
    setMsg(null);
    try {
      await disconnectDrive();
      setMsg({ tone: 'ok', text: 'تم فصل Google Drive وإيقاف النسخ المجدولة.' });
      onChange();
    } catch (e) {
      setMsg({ tone: 'bad', text: errText(e, 'تعذّر الفصل.') });
    } finally {
      setBusy('');
    }
  }

  async function runNow() {
    setBusy('run');
    setMsg(null);
    try {
      const r = await sendToDriveNow();
      setMsg({
        tone: 'ok',
        text: `أُرسلت نسخة مشفّرة إلى Drive (${bytes(r.run.sizeBytes)})${r.trashed ? `، ونُقلت ${num(r.trashed)} نسخة قديمة إلى سلة المهملات` : ''}.`,
      });
    } catch (e) {
      setMsg({ tone: 'bad', text: errText(e, 'تعذّر الإرسال.') });
    } finally {
      setBusy('');
      onChange();
    }
  }

  return (
    <Block
      title="Google Drive"
      hint="نسخ مشفّرة تُرسل إلى مجلد «Patron backups» في حسابك. لا يرى التطبيق من Drive إلا الملفات التي أنشأها بنفسه."
    >
      {!drive.configured && (
        <Notice
          tone="warn"
          text={`Google Drive غير مُعدّ على الخادم بعد. أضف في إعدادات الخادم (Render → Environment): ${drive.missing.join('، ')}. الخطوات في docs/DISASTER_RECOVERY.md.`}
        />
      )}
      {!backupKey.configured && (
        <Notice
          tone="warn"
          text={
            backupKey.problem === 'invalid'
              ? 'BACKUP_ENCRYPTION_KEY على الخادم غير صالح: يجب أن يكون 64 حرفًا ست عشريًا (openssl rand -hex 32).'
              : 'لا يوجد مفتاح للنسخ المجدولة: أضف BACKUP_ENCRYPTION_KEY إلى إعدادات الخادم (openssl rand -hex 32)، واحفظ نسخة منه خارج الخادم وخارج Drive.'
          }
        />
      )}
      {drive.connected ? (
        <div className="flex flex-col gap-3 rounded-xl border hairline p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
          <div className="min-w-0 text-sm">
            <p className="font-bold text-ok">متصل</p>
            <p className="truncate text-muted" dir="ltr">
              {drive.account?.email ?? 'حساب Google'}
            </p>
            {drive.account?.connectedAt && <p className="text-xs text-muted">منذ {dateTime(drive.account.connectedAt)}</p>}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={runNow} disabled={!!busy || !backupKey.configured} className={primaryBtn}>
              {busy === 'run' ? 'جارٍ الإرسال…' : 'إرسال نسخة الآن'}
            </button>
            <button type="button" onClick={disconnect} disabled={!!busy} className={ghostBtn + ' text-bad'}>
              {busy === 'disconnect' ? 'جارٍ…' : 'فصل'}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button type="button" onClick={connect} disabled={!!busy || !drive.configured} className={primaryBtn + ' w-full sm:w-auto'}>
            {busy === 'connect' ? 'جارٍ فتح صفحة Google…' : 'ربط Google Drive'}
          </button>
        </div>
      )}
      {msg && <Notice text={msg.text} tone={msg.tone} />}
    </Block>
  );
}

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border hairline px-3.5 py-2 text-sm font-semibold disabled:opacity-50"
    >
      <span>{label}</span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? 'bg-teal' : 'bg-[rgb(var(--line))]'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'end-0.5' : 'start-0.5'}`} />
      </span>
    </button>
  );
}

const pad = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Daily / weekly switches, the hour (UTC) and how many copies to keep. */
function Schedule({ o, onSaved }: { o: BackupOverview; onSaved: () => void }) {
  const [s, setS] = useState<BackupSchedule>(o.schedule);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => setS(o.schedule), [o.schedule]);

  const canEnable = o.drive.connected && o.backupKey.configured;
  const dirty = JSON.stringify(s) !== JSON.stringify(o.schedule);
  const edit = (patch: Partial<BackupSchedule>) => {
    setS((x) => ({ ...x, ...patch }));
    setMsg(null);
  };

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      await saveSchedule(s);
      setMsg({ tone: 'ok', text: 'تم حفظ الجدول.' });
      onSaved();
    } catch (e) {
      setMsg({ tone: 'bad', text: errText(e, 'تعذّر الحفظ.') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Block
      title="النسخ التلقائي"
      hint="الساعة بتوقيت غرينتش (UTC)، وهو نفس توقيت موريتانيا. إن كان الخادم نائمًا في تلك الساعة تُؤخذ النسخة عند استيقاظه."
    >
      {!canEnable && (
        <p className="text-xs font-semibold text-muted">
          {o.drive.connected ? 'أضف مفتاح BACKUP_ENCRYPTION_KEY على الخادم أولًا.' : 'اربط Google Drive أولًا لتشغيل النسخ التلقائي.'}
        </p>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Switch label="نسخة يومية" on={s.daily} onChange={(v) => edit({ daily: v })} disabled={!canEnable && !s.daily} />
        <Switch label="نسخة أسبوعية" on={s.weekly} onChange={(v) => edit({ weekly: v })} disabled={!canEnable && !s.weekly} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          الساعة (UTC)
          <select value={s.hourUtc} onChange={(e) => edit({ hourUtc: Number(e.target.value) })} className={inputCls} dir="ltr">
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {pad(h)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          يوم الأسبوعية
          <select value={s.weekday} onChange={(e) => edit({ weekday: Number(e.target.value) })} className={inputCls} disabled={!s.weekly}>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-xs font-semibold text-muted sm:col-span-1">
          عدد النسخ المحفوظة من كل نوع
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={60}
            value={s.keep}
            onChange={(e) => edit({ keep: Math.min(60, Math.max(1, Math.round(Number(e.target.value) || 1))) })}
            className={inputCls}
            dir="ltr"
          />
        </label>
      </div>
      <p className="text-xs text-muted">
        النسخ الأقدم من آخر {num(s.keep)} نسخ تُنقل إلى سلة مهملات Drive (تبقى قابلة للاسترجاع 30 يومًا). لا يُلمس أي ملف آخر في
        حسابك.
      </p>
      {(o.nextRuns.daily || o.nextRuns.weekly) && (
        <p className="text-xs font-semibold">
          {o.nextRuns.daily && <span className="me-3">اليومية القادمة: {dateTime(o.nextRuns.daily)}</span>}
          {o.nextRuns.weekly && <span>الأسبوعية القادمة: {dateTime(o.nextRuns.weekly)}</span>}
        </p>
      )}
      <div>
        <button type="button" onClick={save} disabled={saving || !dirty} className={primaryBtn + ' w-full sm:w-auto'}>
          {saving ? 'جارٍ الحفظ…' : 'حفظ الجدول'}
        </button>
      </div>
      {msg && <Notice text={msg.text} tone={msg.tone} />}
    </Block>
  );
}

function Chip({ run }: { run: BackupRun }) {
  const chip = RUN_STATUS[run.status] ?? { label: run.status, cls: 'bg-ink-400/15 text-muted' };
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${chip.cls}`}>{chip.label}</span>;
}

const where = (r: BackupRun) => (r.destination === 'google_drive' ? 'Google Drive' : 'تنزيل');

/** Every attempt: newest first. */
function History({
  runs, loading, error, onReload,
}: { runs: BackupRun[] | null; loading: boolean; error: string | null; onReload: () => void }) {
  const rows = runs ?? [];
  return (
    <Block title="سجل النسخ" hint="كل محاولة نسخ، ناجحة أو فاشلة. عند الفشل يصلك تنبيه عاجل في الإشعارات.">
      <div className="flex justify-end">
        <button type="button" onClick={onReload} className="text-xs font-bold text-teal">
          تحديث
        </button>
      </div>
      {error && <Notice text={error} />}
      {loading && !runs && <p className="text-sm text-muted">جارٍ التحميل…</p>}
      {!loading && !error && rows.length === 0 && <p className="text-sm text-muted">لا توجد نسخ بعد.</p>}

      {/* phones: one card per run */}
      <div className="flex flex-col gap-2 md:hidden">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-col gap-1.5 rounded-xl border hairline p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">
                {TRIGGER_LABEL[r.trigger] ?? r.trigger} · {where(r)}
              </span>
              <Chip run={r} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted">
              <span>{dateTime(r.startedAt)}</span>
              <span>
                {r.encrypted ? 'مشفّرة · ' : ''}
                <span dir="ltr">{bytes(r.sizeBytes)}</span>
              </span>
            </div>
            {r.error && <p className="break-words text-xs text-bad">{r.error}</p>}
          </div>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-xl border hairline md:block">
        {rows.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="surface-2 text-muted">
                {['التاريخ', 'النوع', 'الوجهة', 'مشفّرة', 'الحجم', 'الحالة', 'SHA-256'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-start text-xs font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t hairline align-top">
                  <td className="whitespace-nowrap px-4 py-2.5">{dateTime(r.startedAt)}</td>
                  <td className="px-4 py-2.5">{TRIGGER_LABEL[r.trigger] ?? r.trigger}</td>
                  <td className="px-4 py-2.5">{where(r)}</td>
                  <td className="px-4 py-2.5">{r.encrypted ? 'نعم' : 'لا'}</td>
                  <td className="whitespace-nowrap px-4 py-2.5" dir="ltr">
                    {bytes(r.sizeBytes)}
                  </td>
                  <td className="px-4 py-2.5">
                    <Chip run={r} />
                    {r.error && <p className="mt-1 max-w-72 break-words text-xs text-bad">{r.error}</p>}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted" dir="ltr" title={r.sha256 ?? ''}>
                    {r.sha256 ? `${r.sha256.slice(0, 12)}…` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Block>
  );
}

/** Check that a file would restore, without restoring anything. */
function Verify() {
  const [file, setFile] = useState<File | null>(null);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const locked = !!file && /\.patronbak$/i.test(file.name);

  async function run() {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    setResult(null);
    try {
      setResult(await verifyBackup(file, locked ? pass : undefined));
    } catch (e) {
      setMsg({ tone: 'bad', text: errText(e, 'تعذّر فحص الملف.') });
    } finally {
      setBusy(false);
    }
  }

  const highlights = result ? Object.entries(TABLE_LABEL).filter(([k]) => result.counts[k] !== undefined) : [];

  return (
    <Block
      title="فحص ملف نسخة احتياطية"
      hint="يفتح الملف كما يفعل الاسترجاع (يفك التشفير ويقرأ الجداول ويعدّ الصفوف) دون أن يكتب شيئًا في قاعدة البيانات."
    >
      <div className="flex flex-col gap-3 rounded-xl border hairline p-3 sm:p-4">
        <input
          type="file"
          accept=".json,.patronbak,application/json,application/octet-stream"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setResult(null);
            setMsg(null);
          }}
          className="block w-full min-w-0 text-sm file:me-3 file:rounded-lg file:border-0 file:bg-teal/10 file:px-3 file:py-2 file:text-sm file:font-bold file:text-teal"
        />
        {locked && (
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            عبارة المرور (للنسخ المنزّلة مشفّرة؛ النسخ المجدولة تُفتح بمفتاح الخادم فاتركها فارغة)
            <input
              type="password"
              dir="auto"
              autoComplete="off"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              className={inputCls}
            />
          </label>
        )}
        <div>
          <button type="button" onClick={run} disabled={!file || busy} className={ghostBtn + ' w-full sm:w-auto'}>
            {busy ? 'جارٍ الفحص…' : 'فحص الملف'}
          </button>
        </div>
        {msg && <Notice text={msg.text} tone={msg.tone} />}
        {result && (
          <div className="flex flex-col gap-2 text-sm">
            <Notice
              tone={result.ok ? 'ok' : 'bad'}
              text={
                result.ok
                  ? `الملف سليم ويمكن الاسترجاع منه: الإصدار ${result.version}، أُخذ في ${dateTime(result.exportedAt)}، ${num(result.totalRows)} صفًا${result.encrypted ? '، مشفّر' : ''}.`
                  : 'الملف لا يصلح للاسترجاع:'
              }
            />
            {!result.ok && (
              <ul className="list-inside list-disc text-xs text-bad" dir="ltr">
                {result.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {highlights.length > 0 && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                {highlights.map(([k, label]) => (
                  <div key={k} className="flex justify-between gap-2 border-b hairline py-1">
                    <dt className="text-muted">{label}</dt>
                    <dd className="font-bold tnum">{num(result.counts[k])}</dd>
                  </div>
                ))}
              </dl>
            )}
            <details className="text-xs">
              <summary className="cursor-pointer font-bold text-teal">كل الجداول</summary>
              <dl className="mt-2 grid grid-cols-1 gap-x-4 sm:grid-cols-2" dir="ltr">
                {Object.entries(result.counts).map(([k, n]) => (
                  <div key={k} className="flex justify-between gap-2 border-b hairline py-1">
                    <dt className="text-muted">{k}</dt>
                    <dd className="tnum">{n}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 break-all font-mono text-muted" dir="ltr">
                SHA-256 {result.sha256} · {bytes(result.sizeBytes)}
              </p>
            </details>
          </div>
        )}
      </div>
    </Block>
  );
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
