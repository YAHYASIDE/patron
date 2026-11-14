import { VerificationPurpose } from '@prisma/client';

type Lang = 'ar' | 'fr' | 'en';

const WHY: Record<Lang, Partial<Record<VerificationPurpose, string>> & { default: string }> = {
  ar: {
    EMAIL_VERIFY: 'لتأكيد بريدك الإلكتروني',
    PASSWORD_RESET: 'لتعيين كلمة مرور جديدة',
    ACCOUNT_RECOVERY: 'لاستعادة حسابك',
    PHONE_LOGIN: 'لتسجيل الدخول',
    default: 'للتحقق من حسابك',
  },
  fr: {
    EMAIL_VERIFY: 'pour confirmer votre adresse e-mail',
    PASSWORD_RESET: 'pour choisir un nouveau mot de passe',
    ACCOUNT_RECOVERY: 'pour récupérer votre compte',
    PHONE_LOGIN: 'pour vous connecter',
    default: 'pour vérifier votre compte',
  },
  en: {
    EMAIL_VERIFY: 'to confirm your email',
    PASSWORD_RESET: 'to choose a new password',
    ACCOUNT_RECOVERY: 'to recover your account',
    PHONE_LOGIN: 'to sign in',
    default: 'to verify your account',
  },
};

const SUBJECT: Record<Lang, string> = {
  ar: 'رمز التحقق من patron',
  fr: 'Votre code patron',
  en: 'Your patron code',
};

const BODY: Record<Lang, (why: string, code: string, minutes: number) => string> = {
  ar: (why, code, m) =>
    `رمزك ${why} هو: ${code}\nصالح لمدة ${m} دقيقة. لا تشاركه مع أي أحد، ولن يطلبه منك فريق patron أبدًا.\nإن لم تطلب هذا الرمز فتجاهل الرسالة.`,
  fr: (why, code, m) =>
    `Votre code ${why} : ${code}\nValable ${m} minutes. Ne le partagez avec personne : l'équipe patron ne vous le demandera jamais.\nSi vous n'avez rien demandé, ignorez ce message.`,
  en: (why, code, m) =>
    `Your code ${why}: ${code}\nValid for ${m} minutes. Never share it: the patron team will never ask you for it.\nIf you did not ask for it, ignore this email.`,
};

/** The email that carries a code, in the customer's language (Arabic first). */
export function codeEmail(purpose: VerificationPurpose, code: string, minutes: number, locale?: string | null) {
  const lang: Lang = locale === 'fr' || locale === 'en' ? locale : 'ar';
  const why = WHY[lang][purpose] ?? WHY[lang].default;
  const text = BODY[lang](why, code, minutes);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const html =
    `<div dir="${dir}" style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.6">` +
    text
      .split('\n')
      .map((line) => `<p>${line.replace(code, `<b style="font-size:24px;letter-spacing:4px">${code}</b>`)}</p>`)
      .join('') +
    '</div>';
  return { subject: SUBJECT[lang], text, html };
}
