'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { auth, isAuthed } from '@/lib/api';
import {
  accounts, authError, passkeys, passwordRuleText, strongPassword,
  type DeviceSession, type MeSecurity, type Passkey,
} from '@/lib/auth2';
import { refreshMe } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { dayTime } from '@/components/my/when';
import { VerifySheet } from '@/components/VerifyPanel';
import { FormError, PasswordInput } from '@/components/auth/ContactField';
import { FingerprintIcon, usePasskeysAvailable } from '@/components/auth/PasskeyButton';
import { CheckIcon, ShieldIcon, TrashIcon } from '@/components/icons';

const card = 'surface rounded-2xl p-5 shadow-card';

/** Sign-in & security: password, fingerprint/face, and the devices signed in. */
export default function SecurityPage() {
  const router = useRouter();
  const t = useT();
  const [me, setMe] = useState<MeSecurity | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    accounts.me().then(setMe).catch((e) => setError(authError(e)));
  }, []);

  useEffect(() => {
    if (!isAuthed()) return router.replace('/login?next=/account/security');
    load();
  }, [router, load]);

  return (
    <div className="mx-auto max-w-page px-4 py-8">
      <Link href="/account" className="text-sm font-bold text-muted hover:text-[rgb(var(--text))]">
        {t('حسابي')}
      </Link>
      <h1 className="mt-1 text-2xl font-extrabold">{t('الأمان وتسجيل الدخول')}</h1>
      {!me && !error && <p className="mt-6 text-sm text-muted">{t('جارٍ التحميل…')}</p>}
      <div className="mt-2">
        <FormError message={error} />
      </div>

      {me && (
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <div className="space-y-5">
            <ContactsCard me={me} onChange={load} />
            <PasswordCard me={me} onChange={load} />
          </div>
          <div className="space-y-5">
            <PasskeysCard />
            <SessionsCard />
          </div>
        </div>
      )}
    </div>
  );
}

function ContactsCard({ me, onChange }: { me: MeSecurity; onChange: () => void }) {
  const t = useT();
  const [verifying, setVerifying] = useState(false);
  const badge = (ok: boolean) =>
    ok ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-ok/12 px-2 py-0.5 text-xs font-bold text-ok">
        <CheckIcon size={12} /> {t('موثّق')}
      </span>
    ) : null;

  return (
    <section className={card}>
      <h2 className="text-base font-bold">{t('طرق الدخول')}</h2>
      <div className="mt-3 divide-y divide-[rgb(var(--line))] text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 py-3">
          <span className="text-muted">{t('واتساب')}</span>
          <span className="flex flex-wrap items-center gap-2">
            {me.phone ? (
              <span dir="ltr" className="font-semibold">
                {me.phone}
              </span>
            ) : (
              <span className="text-muted">{t('لا يوجد')}</span>
            )}
            {badge(!!me.phoneVerifiedAt)}
            {!me.phoneVerifiedAt && (
              <button
                onClick={() => setVerifying(true)}
                className="inline-flex items-center gap-1 rounded-full bg-warn/12 px-2.5 py-1 text-xs font-bold text-warn"
              >
                <ShieldIcon size={12} /> {t('وثّقه')}
              </button>
            )}
          </span>
        </div>
        {me.email && (
          <div className="flex flex-wrap items-center justify-between gap-2 py-3">
            <span className="text-muted">{t('البريد الإلكتروني')}</span>
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span dir="ltr" className="break-all font-semibold">
                {me.email}
              </span>
              {badge(!!me.emailVerifiedAt)}
              {!me.emailVerifiedAt && (
                <Link
                  href="/verify-email?next=/account/security"
                  className="rounded-full bg-warn/12 px-2.5 py-1 text-xs font-bold text-warn"
                >
                  {t('أكّده')}
                </Link>
              )}
            </span>
          </div>
        )}
      </div>
      {verifying && (
        <VerifySheet
          onClose={() => {
            setVerifying(false);
            refreshMe();
            onChange();
          }}
        />
      )}
    </section>
  );
}

function PasswordCard({ me, onChange }: { me: MeSecurity; onChange: () => void }) {
  const t = useT();
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [fresh, setFresh] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canSet = !!me.phoneVerifiedAt || !!me.emailVerifiedAt;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!strongPassword(fresh)) return setError(passwordRuleText());
    setBusy(true);
    setError(null);
    try {
      if (me.hasPassword) {
        await accounts.changePassword(current, fresh);
        // a changed password signs every device out, this one included
        await auth.logout().catch(() => undefined);
        refreshMe();
        router.replace('/login?next=/account/security');
        return;
      }
      await accounts.setPassword(fresh);
      setFresh('');
      setNotice(t('أُضيفت كلمة المرور. يمكنك الآن الدخول برقمك وكلمة المرور.'));
      onChange();
    } catch (err) {
      setError(authError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={card}>
      <h2 className="text-base font-bold">{t('كلمة المرور')}</h2>
      {!me.hasPassword && !canSet ? (
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {t('وثّق رقم واتساب أولًا، ثم أضف كلمة مرور لتدخل بها عندما لا يصلك الرمز.')}
        </p>
      ) : (
        <form onSubmit={submit} className="mt-3 flex flex-col gap-3.5">
          {!me.hasPassword && (
            <p className="text-sm leading-relaxed text-muted">
              {t('أضف كلمة مرور لتدخل برقمك وكلمة المرور، دون انتظار رمز.')}
            </p>
          )}
          {me.hasPassword && (
            <PasswordInput value={current} onChange={setCurrent} label={t('كلمة المرور الحالية')} autoComplete="current-password" />
          )}
          <PasswordInput
            value={fresh}
            onChange={setFresh}
            label={t('كلمة المرور الجديدة')}
            autoComplete="new-password"
            hint={t('كلمة المرور: 10 أحرف على الأقل، فيها حرف كبير وحرف صغير ورقم.')}
          />
          <FormError message={error} />
          {notice && <p className="text-sm text-ok">{notice}</p>}
          <button type="submit" disabled={busy} className="btn-brand rounded-xl py-3 text-sm font-bold disabled:opacity-60">
            {busy ? t('جارٍ الحفظ…') : me.hasPassword ? t('تغيير كلمة المرور') : t('إضافة كلمة مرور')}
          </button>
          {me.hasPassword && (
            <p className="text-xs text-muted">{t('بعد التغيير ستخرج من كل الأجهزة، وتدخل من جديد بكلمة المرور الجديدة.')}</p>
          )}
        </form>
      )}
    </section>
  );
}

function PasskeysCard() {
  const t = useT();
  const available = usePasskeysAvailable();
  const [list, setList] = useState<Passkey[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    passkeys.list().then(setList).catch((e) => setError(authError(e)));
  }, []);
  useEffect(load, [load]);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await passkeys.add();
      load();
    } catch (e) {
      setError(authError(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await passkeys.remove(id);
      load();
    } catch (e) {
      setError(authError(e));
    }
  }

  return (
    <section className={card}>
      <div className="flex items-center gap-2">
        <FingerprintIcon className="text-teal" />
        <h2 className="text-base font-bold">{t('البصمة أو الوجه')}</h2>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">
        {t('ادخل بلمسة إصبع أو بنظرة، دون رمز أو كلمة مرور. البصمة نفسها تبقى في هاتفك ولا تصلنا.')}
      </p>

      {list && list.length > 0 && (
        <ul className="mt-3 divide-y divide-[rgb(var(--line))]">
          {list.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-3 text-sm">
              <span className="min-w-0">
                <span className="block font-semibold">{p.deviceName || t('جهاز')}</span>
                <span className="block text-xs text-muted">
                  {p.lastUsedAt ? t('آخر استخدام {when}', { when: dayTime(p.lastUsedAt) }) : t('أُضيف {when}', { when: dayTime(p.createdAt) })}
                </span>
              </span>
              <button
                onClick={() => remove(p.id)}
                aria-label={t('حذف')}
                className="grid h-9 w-9 flex-none place-items-center rounded-lg text-muted transition hover:bg-bad/10 hover:text-bad"
              >
                <TrashIcon size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3">
        <FormError message={error} />
      </div>
      {available ? (
        <button
          onClick={add}
          disabled={busy}
          className="btn-brand mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:opacity-60"
        >
          <FingerprintIcon size={18} />
          {busy ? t('جارٍ الإضافة…') : t('أضف البصمة/الوجه')}
        </button>
      ) : (
        <p className="mt-3 text-xs text-muted">{t('هذا المتصفح لا يدعم الدخول بالبصمة أو الوجه. جرّبه من هاتفك.')}</p>
      )}
    </section>
  );
}

function SessionsCard() {
  const t = useT();
  const [list, setList] = useState<DeviceSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    accounts.sessions().then(setList).catch((e) => setError(authError(e)));
  }, []);
  useEffect(load, [load]);

  async function signOut(id: string) {
    setError(null);
    try {
      await accounts.revokeSession(id);
      load();
    } catch (e) {
      setError(authError(e));
    }
  }

  async function signOutOthers() {
    setError(null);
    try {
      const { revoked } = await accounts.revokeOtherSessions();
      setNotice(t('خرجت من {n} جهاز آخر.', { n: revoked }));
      load();
    } catch (e) {
      setError(authError(e));
    }
  }

  const others = (list ?? []).filter((s) => !s.current).length;

  return (
    <section className={card}>
      <h2 className="text-base font-bold">{t('الأجهزة المتصلة')}</h2>
      {!list && !error && <p className="mt-3 text-sm text-muted">{t('جارٍ التحميل…')}</p>}
      {list && (
        <ul className="mt-3 divide-y divide-[rgb(var(--line))]">
          {list.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-3 text-sm">
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 font-semibold">
                  {s.deviceInfo || t('جهاز غير معروف')}
                  {s.current && (
                    <span className="rounded-full bg-teal/12 px-2 py-0.5 text-xs font-bold text-teal">{t('هذا الجهاز')}</span>
                  )}
                </span>
                <span className="block text-xs text-muted">
                  {t('آخر نشاط {when}', { when: dayTime(s.lastUsedAt) })}
                  {s.ipAddress && (
                    <>
                      {' · '}
                      <span dir="ltr">{s.ipAddress}</span>
                    </>
                  )}
                </span>
              </span>
              {!s.current && (
                <button
                  onClick={() => signOut(s.id)}
                  className="flex-none rounded-lg border border-[rgb(var(--line))] px-3 py-1.5 text-xs font-bold text-muted transition hover:border-bad hover:text-bad"
                >
                  {t('تسجيل الخروج')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2">
        <FormError message={error} />
      </div>
      {notice && <p className="mt-2 text-sm text-ok">{notice}</p>}
      {others > 0 && (
        <button
          onClick={signOutOthers}
          className="mt-3 w-full rounded-xl border border-[rgb(var(--line))] py-3 text-sm font-bold text-muted transition hover:border-bad hover:text-bad"
        >
          {t('تسجيل الخروج من كل الأجهزة الأخرى')}
        </button>
      )}
      <p className="mt-3 text-xs leading-relaxed text-muted">
        {t('لا تعرف جهازًا في القائمة؟ أخرجه، ثم غيّر كلمة المرور إن كانت لديك.')}
      </p>
    </section>
  );
}
