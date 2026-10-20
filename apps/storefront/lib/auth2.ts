'use client';

import { ApiError, request, storeTokens } from './api';
import { tNow } from './i18n';
import type { Me, TokenPair } from './types';

/**
 * Accounts & sign-in beyond the WhatsApp number (which stays in lib/api.ts):
 * email or phone + password, email verification, password reset, support
 * recovery, fingerprint/face (passkeys) and the device list.
 */

export type MeSecurity = Me & {
  emailVerifiedAt?: string | null;
  hasPassword: boolean;
  passkeyCount: number;
};

export type DeviceSession = {
  id: string;
  deviceInfo: string | null;
  ipAddress: string | null;
  signedInAt: string;
  lastUsedAt: string;
  current: boolean;
};

export type Passkey = { id: string; deviceName: string | null; createdAt: string; lastUsedAt: string | null };

export const accounts = {
  me() {
    return request<MeSecurity>('/auth/me', { auth: true });
  },
  /** `identifier`: an email or an international number (+222…). */
  async login(identifier: string, password: string) {
    const t = await request<TokenPair>('/auth/login', { method: 'POST', body: { identifier, password } });
    storeTokens(t);
    return t;
  },
  async register(body: { email: string; password: string; fullName: string; locale?: string }) {
    const t = await request<TokenPair>('/auth/register', { method: 'POST', body });
    storeTokens(t);
    return t;
  },
  verifyEmail(code: string) {
    return request<{ message: string }>('/auth/verify-email', { method: 'POST', body: { code }, auth: true });
  },
  resendEmailCode() {
    return request<{ status: 'SENT' | 'VERIFIED' }>('/auth/verify-email/resend', { method: 'POST', auth: true });
  },
  forgotPassword(identifier: string) {
    return request<{ message: string; channel: 'email' | 'phone' }>('/auth/forgot-password', {
      method: 'POST',
      body: { identifier },
    });
  },
  resetPassword(identifier: string, code: string, newPassword: string) {
    return request<{ message: string }>('/auth/reset-password', {
      method: 'POST',
      body: { identifier, code, newPassword },
    });
  },
  setPassword(newPassword: string) {
    return request<{ message: string }>('/auth/password', { method: 'POST', body: { newPassword }, auth: true });
  },
  changePassword(currentPassword: string, newPassword: string) {
    return request<{ message: string }>('/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
      auth: true,
    });
  },
  sessions() {
    return request<DeviceSession[]>('/auth/sessions', { auth: true });
  },
  revokeSession(id: string) {
    return request<{ revoked: true }>(`/auth/sessions/${id}`, { method: 'DELETE', auth: true });
  },
  revokeOtherSessions() {
    return request<{ revoked: number }>('/auth/sessions/revoke-others', { method: 'POST', auth: true });
  },
  requestRecovery(body: { contact: string; fullName: string; proof: string; newContact?: string }) {
    return request<{ message: string }>('/auth/recovery', { method: 'POST', body });
  },
  completeRecovery(body: { contact: string; code: string; newPassword: string }) {
    return request<{ message: string; identifier: string }>('/auth/recovery/complete', { method: 'POST', body });
  },
};

// ─────────────── Passkeys (fingerprint / face) ───────────────

/** True only where the phone (or computer) can unlock with its own fingerprint, face or PIN. */
export async function passkeysAvailable(): Promise<boolean> {
  try {
    const { browserSupportsWebAuthn, platformAuthenticatorIsAvailable } = await import('@simplewebauthn/browser');
    return browserSupportsWebAuthn() && (await platformAuthenticatorIsAvailable());
  } catch {
    return false;
  }
}

export const passkeys = {
  list() {
    return request<Passkey[]>('/auth/passkeys', { auth: true });
  },
  remove(id: string) {
    return request<{ deleted: true }>(`/auth/passkeys/${id}`, { method: 'DELETE', auth: true });
  },
  /** Add this device's fingerprint/face to the signed-in account. */
  async add() {
    const { startRegistration } = await import('@simplewebauthn/browser');
    const { challengeId, options } = await request<{ challengeId: string; options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>(
      '/auth/passkeys/register/options',
      { method: 'POST', auth: true },
    );
    const response = await startRegistration({ optionsJSON: options });
    return request<Passkey>('/auth/passkeys/register/verify', {
      method: 'POST',
      body: { challengeId, response },
      auth: true,
    });
  },
  /** Sign in with a passkey this device holds for the shop (no name to type). */
  async signIn() {
    const { startAuthentication } = await import('@simplewebauthn/browser');
    const { challengeId, options } = await request<{
      challengeId: string;
      options: Parameters<typeof startAuthentication>[0]['optionsJSON'];
    }>('/auth/passkeys/login/options', { method: 'POST' });
    const response = await startAuthentication({ optionsJSON: options });
    const t = await request<TokenPair>('/auth/passkeys/login/verify', { method: 'POST', body: { challengeId, response } });
    storeTokens(t);
    return t;
  },
};

// ─────────────── Errors in the customer's language ───────────────

function wait(seconds: unknown): string {
  const s = typeof seconds === 'number' && seconds > 0 ? Math.ceil(seconds) : 60;
  return s < 60
    ? tNow('انتظر {s} ثانية ثم حاول مجددًا.', { s })
    : tNow('انتظر {m} دقيقة ثم حاول مجددًا.', { m: Math.ceil(s / 60) });
}

/** One sentence the customer can act on, for any error of the sign-in pages. */
export function authError(err: unknown): string {
  // the browser's own fingerprint/face sheet was closed or timed out
  if (err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
    return tNow('أُلغي التحقق بالبصمة أو الوجه.');
  }
  if (!(err instanceof ApiError)) return tNow('تعذّر الاتصال بالخادم. حاول مرة أخرى.');
  const retryAfter = err.body?.retryAfter;
  switch (err.code) {
    case 'INVALID_CREDENTIALS':
      return tNow('البيانات أو كلمة المرور غير صحيحة.');
    case 'TOO_MANY_ATTEMPTS':
      return `${tNow('محاولات كثيرة من هذا الجهاز.')} ${wait(retryAfter)}`;
    case 'RESEND_COOLDOWN':
      return `${tNow('أُرسل رمز قبل قليل.')} ${wait(retryAfter)}`;
    case 'INVALID_CODE':
      return tNow('الرمز غير صحيح أو انتهت صلاحيته.');
    case 'CODE_ATTEMPTS_EXCEEDED':
      return tNow('محاولات كثيرة لهذا الرمز. اطلب رمزًا جديدًا.');
    case 'EMAIL_NOT_CONFIGURED':
      return tNow('إرسال الرموز بالبريد غير متاح حاليًا. استخدم رقم واتساب أو اطلب مساعدة المتجر.');
    case 'SMS_SEND_FAILED':
    case 'EMAIL_SEND_FAILED':
    case 'SMS_CHECK_FAILED':
      return tNow('تعذّر إرسال الرمز أو التحقق منه الآن. حاول بعد قليل.');
    case 'INVALID_IDENTIFIER':
      return tNow('اكتب بريدًا إلكترونيًا أو رقمًا بالصيغة الدولية مثل +22222123456.');
    case 'ACCOUNT_EXISTS':
      return tNow('يوجد حساب بهذه البيانات. سجّل الدخول بدلًا من ذلك.');
    case 'ACCOUNT_BLOCKED':
    case 'ACCOUNT_INACTIVE':
      return tNow('هذا الحساب موقوف. تواصل مع المتجر.');
    case 'VERIFY_FIRST':
      return tNow('وثّق رقمك أولًا ثم أضف كلمة المرور.');
    case 'PASSWORD_ALREADY_SET':
      return tNow('لحسابك كلمة مرور بالفعل. يمكنك تغييرها.');
    case 'WRONG_PASSWORD':
      return tNow('كلمة المرور الحالية غير صحيحة.');
    case 'SAME_PASSWORD':
      return tNow('اختر كلمة مرور مختلفة عن الحالية.');
    case 'PASSKEYS_NOT_CONFIGURED':
      return tNow('الدخول بالبصمة أو الوجه غير متاح حاليًا.');
    case 'PASSKEY_EXISTS':
      return tNow('هذا الجهاز مضاف بالفعل.');
    case 'PASSKEY_INVALID':
    case 'PASSKEY_CHALLENGE_EXPIRED':
      return tNow('لم يُقبل التحقق بالبصمة أو الوجه. حاول مجددًا أو ادخل بطريقة أخرى.');
    case 'SESSION_NOT_FOUND':
      return tNow('هذا الجهاز خرج بالفعل.');
    case 'SESSION_UNKNOWN':
      return tNow('سجّل الدخول من جديد لإدارة أجهزتك.');
  }
  if (err.status === 400 && /Password needs/i.test(err.message)) return passwordRuleText();
  if (err.status === 400 && /code is 6 digits/i.test(err.message)) return tNow('الرمز 6 أرقام.');
  if (err.status === 429) return tNow('محاولات كثيرة. انتظر دقيقة ثم حاول.');
  if (err.status === 0) return err.message;
  return tNow('حدث خطأ غير متوقّع.');
}

export const passwordRuleText = () => tNow('كلمة المرور: 10 أحرف على الأقل، فيها حرف كبير وحرف صغير ورقم.');

/** Same rule as the API, checked before sending. */
export const strongPassword = (p: string) => /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{10,}$/.test(p);
