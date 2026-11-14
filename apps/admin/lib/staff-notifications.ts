/**
 * The owner's notification center (GET /admin/staff-notifications…), shared by
 * the header bell and the /notifications page. The Android admin app reads the
 * same API.
 */
import { api } from './api';

export type StaffPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type InboxState = 'open' | 'all' | 'resolved';

export type StaffNotice = {
  id: string;
  type: string;
  priority: StaffPriority;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  readAt: string | null;
  resolvedAt: string | null;
  remindCount: number;
};
export type Inbox = { data: StaffNotice[]; unread: number; open: number };

const BASE = '/admin/staff-notifications';
export const inboxPath = (state: InboxState = 'open', limit = 50) => `${BASE}?state=${state}&limit=${limit}`;
export const getInbox = (state?: InboxState, limit?: number) => api.get<Inbox>(inboxPath(state, limit));
export const markRead = (id: string) => api.post<StaffNotice>(`${BASE}/${id}/read`);
export const markAllRead = () => api.post<{ updated: number }>(`${BASE}/read-all`);
export const resolveNotice = (id: string) => api.post<StaffNotice>(`${BASE}/${id}/resolve`);
export const getPrefs = () => api.get<{ muted: string[] }>(`${BASE}/prefs`);
export const setPrefs = (muted: string[]) => api.put<{ muted: string[] }>(`${BASE}/prefs`, { muted });

/** Fired after a change on the page so the bell refreshes at once instead of at its next poll. */
export const INBOX_CHANGED = 'patron-staff-inbox-changed';
export function inboxChanged() {
  try {
    window.dispatchEvent(new Event(INBOX_CHANGED));
  } catch {
    /* not in a browser */
  }
}

/** The kinds of notices the shop raises, in the order the settings list them. */
export const NOTICE_TYPES: Record<string, string> = {
  'order.new': 'طلب مدفوع للتسليم',
  'payment.pending': 'تحويل بانتظار المراجعة',
  'order.failed': 'طلب فشل تسليمه',
  'refund.pending': 'استرجاع بانتظار التنفيذ',
  'support.message': 'رسالة دعم من زبون',
  'system.error': 'خطأ في الخادم',
  'bank.match': 'إشعار بنكي يطابق طلبًا',
  'bank.unmatched': 'إشعار بنكي بلا طلب',
  'backup.failed': 'فشل النسخ الاحتياطي',
  'usdt.new': 'طلب USDT',
  'recovery.request': 'طلب استعادة حساب',
};
export const typeLabel = (type: string) => NOTICE_TYPES[type] ?? type;

export const PRIORITY: Record<StaffPriority, { label: string; dot: string; chip: string }> = {
  URGENT: { label: 'عاجل', dot: 'bg-bad', chip: 'bg-bad/12 text-bad' },
  HIGH: { label: 'مهم', dot: 'bg-warn', chip: 'bg-warn/12 text-warn' },
  NORMAL: { label: 'عادي', dot: 'bg-teal', chip: 'bg-teal/12 text-teal' },
  LOW: { label: 'منخفض', dot: 'bg-ink-400', chip: 'bg-ink-400/15 text-muted' },
};
export const PRIORITIES: StaffPriority[] = ['URGENT', 'HIGH', 'NORMAL', 'LOW'];
export const priorityOf = (p: string) => PRIORITY[p as StaffPriority] ?? PRIORITY.NORMAL;

/** "منذ 5 د" — short, Latin digits, for lists. */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'الآن';
  const m = Math.round(s / 60);
  if (m < 60) return `منذ ${m} د`;
  const h = Math.round(m / 60);
  if (h < 24) return `منذ ${h} س`;
  const d = Math.round(h / 24);
  return `منذ ${d} ي`;
}

/** Links point inside the dashboard; anything else is ignored rather than followed. */
export const safeLink = (link: string | null) =>
  link && link.startsWith('/') && !link.startsWith('//') ? link : null;
