/** Agents (المندوبون): types for /admin/agents and helpers shared by its pages. */

export type Statement = {
  currency: string;
  pending: { count: number; amount: string };
  earned: { count: number; amount: string };
  paid: { count: number; amount: string };
  void: { count: number; amount: string };
  clawback: { total: string; recovered: string; open: string };
  payouts: { count: number; total: string };
  balanceDue: string;
};

export type Rule = { commissionType: 'PERCENT' | 'FIXED'; commissionValue: string };

export type AgentRow = Rule & {
  id: string;
  code: string;
  isActive: boolean;
  note: string | null;
  createdAt: string;
  user: { id: string; fullName: string; phone: string | null };
  referralsCount: number;
  ordersCount: number;
  statement: Statement;
};

export type CommissionStatus = 'PENDING' | 'EARNED' | 'PAID' | 'VOID';

export type Commission = {
  id: string;
  orderId: string;
  basis: string;
  amount: string;
  currency: string;
  rule: { type: 'PERCENT' | 'FIXED'; value: string };
  status: CommissionStatus;
  payoutId: string | null;
  voidReason: string | null;
  clawbackAmount: string | null;
  clawbackRecovered: string | null;
  clawbackReason: string | null;
  clawbackAt: string | null;
  earnedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  order: { id: string; orderNumber: string; status: string; total: string; currency: string; user: { id: string; fullName: string } };
};

export type Payout = {
  id: string;
  amount: string;
  currency: string;
  reference: string | null;
  note: string | null;
  clawbackDeducted: string | null;
  createdAt: string;
  commissionsCount: number;
};

export type AgentDetail = Omit<AgentRow, 'user'> & {
  shareLink: string | null;
  user: { id: string; fullName: string; phone: string | null; email: string | null; createdAt: string };
  referrals: { id: string; fullName: string; phone: string | null; createdAt: string; ordersCount: number }[];
  commissions: Commission[];
  payouts: Payout[];
};

export const COMMISSION_STATUS: Record<CommissionStatus, { label: string; cls: string }> = {
  PENDING: { label: 'قيد الانتظار', cls: 'bg-warn/12 text-warn' },
  EARNED: { label: 'مستحقة', cls: 'bg-teal/12 text-teal' },
  PAID: { label: 'مدفوعة', cls: 'bg-ok/12 text-ok' },
  VOID: { label: 'ملغاة', cls: 'bg-ink-400/15 text-muted' },
};

export const VOID_REASON: Record<string, string> = {
  order_cancelled: 'أُلغي الطلب',
  order_failed: 'فشل الطلب',
  order_refunded: 'استُرجع الطلب',
  partial_refund: 'استرجاع جزئي',
};

/** The store link an agent shares. */
export function storeLink(code: string, shareLink?: string | null): string {
  if (shareLink) return shareLink;
  const store = (process.env.NEXT_PUBLIC_STORE_URL ?? 'https://etssadagha-store.onrender.com').replace(/\/+$/, '');
  return `${store}/?ref=${encodeURIComponent(code)}`;
}

export function ruleText(r: Rule, money: (n: string) => string): string {
  return r.commissionType === 'PERCENT'
    ? `${Number(r.commissionValue).toLocaleString('en', { maximumFractionDigits: 2 })}% من صافي الطلب`
    : `${money(r.commissionValue)} عن كل طلب`;
}

/** "22 12 34 56", "0022212345678" or "+222 12345678" → "+22212345678" (country code included). */
export function normalizePhone(text: string): string {
  let v = text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[^\d+]/g, '');
  if (v.startsWith('00')) v = `+${v.slice(2)}`;
  if (!v.startsWith('+') && v) v = `+${v}`;
  return v;
}

/** Positive amount, Arabic digits and a comma accepted; null when not a number. */
export function parsePositive(text: string): number | null {
  const v = text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[٫,]/, '.').trim();
  if (!/^\d+(\.\d{1,4})?$/.test(v)) return null;
  const n = Number(v);
  return n > 0 ? n : null;
}

/**
 * The API's agents errors, in Arabic. The dashboard client keeps the message,
 * not the code, so the stable English messages are matched.
 */
const ERRORS: Array<[RegExp, string]> = [
  [/code is taken|free code/i, 'هذا الرمز مستخدم. اختر رمزًا آخر.'],
  [/already an agent/i, 'هذا الحساب مندوب بالفعل.'],
  [/User not found/i, 'لا يوجد حساب بهذا المعرّف.'],
  [/full name/i, 'هذا الرقم ليس له حساب: اكتب اسم المندوب لإنشائه.'],
  [/percentage cannot exceed/i, 'النسبة لا تتجاوز 100%.'],
  [/not earned and unpaid|changed meanwhile/i, 'تغيّرت بعض العمولات (دُفعت أو أُلغيت). حدّث الصفحة وأعد الاختيار.'],
  [/Agent not found/i, 'المندوب غير موجود.'],
  [/role missing/i, 'دور «مندوب» غير موجود في قاعدة البيانات.'],
  [/code must be/i, 'الرمز من 4 إلى 12 حرفًا لاتينيًا أو رقمًا.'],
  [/E\.164/i, 'اكتب الرقم كاملًا مع رمز الدولة، مثل ‎+22222123456.'],
];

export function agentError(e: unknown, fallback: string): string {
  if (!(e instanceof Error)) return fallback;
  if ((e as { status?: number }).status === 403) return 'ليست لديك صلاحية إدارة المندوبين.';
  return ERRORS.find(([re]) => re.test(e.message))?.[1] ?? (e.message || fallback);
}
