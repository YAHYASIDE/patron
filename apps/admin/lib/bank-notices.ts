/**
 * Bank notifications forwarded by the owner's Android phone (/admin/bank-notices).
 * Evidence to help the owner find a transfer — never an approval.
 */
import { api } from './api';

export type BankStatus = 'NEW' | 'SUGGESTED' | 'CONFIRMED' | 'IGNORED' | 'DUPLICATE';

export type PaymentBrief = {
  id: string;
  orderId: string;
  orderNumber: string;
  amount: string;
  currency: string;
  status: string;
};

export type BankNotice = {
  id: string;
  deviceId: string;
  sourceApp: string;
  title: string | null;
  text: string;
  postedAt: string;
  receivedAt: string;
  amount: string | null;
  currency: string | null;
  reference: string | null;
  sender: string | null;
  confidence: number;
  parser: string;
  status: BankStatus;
  duplicate: boolean;
  duplicateOfId: string | null;
  suggestedPaymentId: string | null;
  matchedPaymentId: string | null;
  suggestedPayment: PaymentBrief | null;
  matchedPayment: PaymentBrief | null;
  reviewedAt: string | null;
  reviewNote: string | null;
};

const BASE = '/admin/bank-notices';
export const bankNoticesPath = (status?: BankStatus | '', limit = 100) =>
  `${BASE}?limit=${limit}${status ? `&status=${status}` : ''}`;
export const confirmNotice = (id: string, paymentId: string) =>
  api.post<BankNotice>(`${BASE}/${id}/confirm`, { paymentId });
export const ignoreNotice = (id: string, note?: string) =>
  api.post<BankNotice>(`${BASE}/${id}/ignore`, note ? { note } : {});
export const getBankConfig = () => api.get<{ allowedApps: string[] }>(`${BASE}/config`);
export const setBankConfig = (allowedApps: string[]) =>
  api.put<{ allowedApps: string[] }>(`${BASE}/config`, { allowedApps });

export const BANK_STATUS: Record<BankStatus, { label: string; cls: string }> = {
  NEW: { label: 'بلا طلب مطابق', cls: 'bg-warn/12 text-warn' },
  SUGGESTED: { label: 'مطابقة مقترحة', cls: 'bg-teal/12 text-teal' },
  CONFIRMED: { label: 'مربوط بدفعة', cls: 'bg-ok/12 text-ok' },
  IGNORED: { label: 'متجاهَل', cls: 'bg-ink-400/15 text-muted' },
  DUPLICATE: { label: 'مكرر', cls: 'bg-bad/12 text-bad' },
};

/** An Android package name, e.g. mr.bankily.app (same rule as the API). */
export const APP_ID = /^[A-Za-z0-9_][A-Za-z0-9_.-]{1,127}$/;
