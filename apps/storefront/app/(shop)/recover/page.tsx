'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { warmUp } from '@/lib/api';
import { accounts, authError, passwordRuleText, strongPassword } from '@/lib/auth2';
import { refreshMe } from '@/lib/session';
import { useT } from '@/lib/i18n';
import ContactField, { authField, CodeInput, FormError, PasswordInput, type ContactValue } from '@/components/auth/ContactField';
import { CheckIcon, ShieldIcon } from '@/components/icons';

/**
 * «طلب مساعدة لاستعادة حسابي»: for a customer who lost their number, email or
 * password. The shop's team checks the details against the account's orders,
 * then a code is sent to the contact the customer gives here. The team never
 * sees the code and never chooses the password.
 */
export default function RecoverPage() {
  const router = useRouter();
  const t = useT();
  const [step, setStep] = useState<'ask' | 'sent' | 'finish'>('ask');
  const [contact, setContact] = useState<ContactValue>({ value: '', problem: null });
  const [newContact, setNewContact] = useState<ContactValue>({ value: '', problem: null });
  const [lostContact, setLostContact] = useState(false);
  const [fullName, setFullName] = useState('');
  const [proof, setProof] = useState('');
  const [codeAt, setCodeAt] = useState<ContactValue>({ value: '', problem: null });
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => warmUp(), []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (contact.problem) return setError(contact.problem);
    if (lostContact && newContact.problem) return setError(newContact.problem);
    if (fullName.trim().length < 2) return setError(t('اكتب اسمك الكامل.'));
    if (proof.trim().length < 10) return setError(t('اكتب تفاصيل أكثر تساعدنا على التأكد أن الحساب لك.'));
    setBusy(true);
    setError(null);
    try {
      await accounts.requestRecovery({
        contact: contact.value,
        fullName: fullName.trim(),
        proof: proof.trim(),
        ...(lostContact && newContact.value ? { newContact: newContact.value } : {}),
      });
      setStep('sent');
    } catch (err) {
      setError(authError(err));
    } finally {
      setBusy(false);
    }
  }

  async function finish(e: React.FormEvent) {
    e.preventDefault();
    if (codeAt.problem) return setError(codeAt.problem);
    if (!/^\d{6}$/.test(code)) return setError(t('الرمز 6 أرقام.'));
    if (!strongPassword(password)) return setError(passwordRuleText());
    setBusy(true);
    setError(null);
    try {
      const res = await accounts.completeRecovery({ contact: codeAt.value, code, newPassword: password });
      await accounts.login(res.identifier, password);
      refreshMe();
      router.replace('/account/security');
    } catch (err) {
      setError(authError(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-page px-4 py-10">
      <div className="mx-auto max-w-[480px]">
        <h1 className="text-2xl font-extrabold">{t('استعادة حسابي بمساعدة المتجر')}</h1>

        {step === 'ask' && (
          <>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              {t('فقدت رقمك أو بريدك؟ أرسل لنا ما يثبت أن الحساب لك، وسيراجعه فريق المتجر ثم يصلك رمز لتختار كلمة مرور جديدة.')}
            </p>
            <form onSubmit={send} className="surface mt-6 flex flex-col gap-4 rounded-2xl p-5 shadow-card sm:p-6">
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-bold">{t('الرقم أو البريد المسجّل في الحساب')}</span>
                <ContactField onChange={setContact} autoFocus />
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold">{t('الاسم الكامل')}</span>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  autoComplete="name"
                  maxLength={80}
                  className={authField}
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold">{t('ما يثبت أن الحساب لك')}</span>
                <textarea
                  value={proof}
                  onChange={(e) => setProof(e.target.value)}
                  rows={4}
                  maxLength={1000}
                  placeholder={t('مثال: آخر طلب كان شحن PUBG بـ 500 أوقية يوم 12، رقم الطلب إن وجد، طريقة الدفع…')}
                  className={authField + ' resize-y leading-relaxed'}
                />
                <span className="text-xs text-muted">{t('لا تكتب كلمة مرور أو رمزًا هنا أبدًا.')}</span>
              </label>

              <label className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={lostContact}
                  onChange={(e) => setLostContact(e.target.checked)}
                  className="mt-1 h-4 w-4 flex-none accent-teal"
                />
                <span>{t('لم أعد أملك هذا الرقم أو البريد، أرسلوا الرمز إلى رقم أو بريد جديد')}</span>
              </label>
              {lostContact && (
                <div className="flex flex-col gap-1.5 rounded-xl border border-dashed border-[rgb(var(--line))] p-3">
                  <span className="text-sm font-bold">{t('الرقم أو البريد الجديد')}</span>
                  <ContactField onChange={setNewContact} />
                </div>
              )}

              <FormError message={error} />
              <button
                type="submit"
                disabled={busy}
                className="btn-brand rounded-xl py-3.5 text-[15px] font-bold disabled:opacity-60"
              >
                {busy ? t('جارٍ الإرسال…') : t('أرسل الطلب')}
              </button>
              <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
                <ShieldIcon size={15} className="mt-0.5 flex-none text-teal" />
                {t('فريق المتجر لا يرى الرمز ولا كلمة المرور، ولن يطلبهما منك أبدًا.')}
              </p>
            </form>
            <button
              onClick={() => {
                setStep('finish');
                setError(null);
              }}
              className="mt-5 text-sm font-bold text-teal hover:underline"
            >
              {t('وصلني رمز الاستعادة')}
            </button>
          </>
        )}

        {step === 'sent' && (
          <div className="surface mt-6 flex flex-col items-center gap-3 rounded-2xl p-6 text-center shadow-card">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-ok/12 text-ok">
              <CheckIcon size={24} />
            </span>
            <p className="font-bold">{t('وصلنا طلبك.')}</p>
            <p className="text-sm leading-relaxed text-muted">
              {t('إن طابقت التفاصيل حسابًا، فسيراجعها الفريق ويصلك رمز على الرقم أو البريد الذي اخترته. عندها عد إلى هذه الصفحة.')}
            </p>
            <button
              onClick={() => setStep('finish')}
              className="btn-brand mt-2 w-full rounded-xl py-3 text-sm font-bold"
            >
              {t('وصلني رمز الاستعادة')}
            </button>
          </div>
        )}

        {step === 'finish' && (
          <>
            <p className="mt-1.5 text-sm text-muted">{t('اكتب الرقم أو البريد الذي وصله الرمز، ثم اختر كلمة مرور جديدة.')}</p>
            <form onSubmit={finish} className="surface mt-6 flex flex-col gap-4 rounded-2xl p-5 shadow-card sm:p-6">
              <ContactField onChange={setCodeAt} autoFocus />
              <CodeInput value={code} onChange={setCode} label={t('رمز الاستعادة')} />
              <PasswordInput
                value={password}
                onChange={setPassword}
                label={t('كلمة المرور الجديدة')}
                autoComplete="new-password"
                hint={t('كلمة المرور: 10 أحرف على الأقل، فيها حرف كبير وحرف صغير ورقم.')}
              />
              <FormError message={error} />
              <button
                type="submit"
                disabled={busy}
                className="btn-brand rounded-xl py-3.5 text-[15px] font-bold disabled:opacity-60"
              >
                {busy ? t('جارٍ الحفظ…') : t('استعادة الحساب والدخول')}
              </button>
            </form>
          </>
        )}

        <p className="mt-6 text-sm">
          <Link href="/login" className="font-bold text-muted hover:text-[rgb(var(--text))]">
            {t('العودة لتسجيل الدخول')}
          </Link>
        </p>
      </div>
    </div>
  );
}
