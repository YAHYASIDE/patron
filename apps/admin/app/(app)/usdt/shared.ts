/** Shapes and labels shared by the USDT dashboard pages. */

export type UsdtNetwork = 'TRC20' | 'BEP20' | 'ERC20';
export type UsdtStatus = 'NEW' | 'AWAITING_PAYMENT' | 'UNDER_REVIEW' | 'READY_TO_SEND' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';

export type UsdtOrderRow = {
  id: string;
  number: string;
  status: UsdtStatus;
  amountUsdt: string;
  delivery: 'ONCHAIN' | 'BINANCE';
  network: UsdtNetwork | null;
  address: string | null;
  binanceId: string | null;
  rate: string;
  currency: string;
  subtotal: string;
  fee: string;
  total: string;
  paymentMethod: string | null;
  payerPhone: string | null;
  paymentRef: string | null;
  hasProof: boolean;
  txid: string | null;
  rejectReason: string | null;
  expiresAt: string | null;
  paidAt: string | null;
  approvedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  user?: { id: string; fullName: string; phone: string | null; email?: string | null; phoneVerifiedAt?: string | null };
};

export type UsdtEvent = {
  id: string;
  action: string;
  fromStatus: UsdtStatus | null;
  toStatus: UsdtStatus | null;
  note: string | null;
  data: Record<string, unknown> | null;
  actorName: string | null;
  createdAt: string;
};

export type UsdtDetail = UsdtOrderRow & {
  reviewedBy: { id: string; fullName: string } | null;
  previousCompleted: number;
  events: UsdtEvent[];
};

export type UsdtConfig = {
  enabled: boolean;
  rates: Record<string, string>;
  feePercent: string;
  feeFixedUsdt: string;
  minUsdt: string;
  maxUsdt: string;
  networks: Record<UsdtNetwork, boolean>;
  binanceEnabled: boolean;
  expiryMinutes: number;
};

export const STATUS: Record<UsdtStatus, { label: string; cls: string }> = {
  NEW: { label: 'جديد', cls: 'surface-2 text-muted' },
  AWAITING_PAYMENT: { label: 'بانتظار الدفع', cls: 'bg-warn/12 text-warn' },
  UNDER_REVIEW: { label: 'للمراجعة', cls: 'bg-warn/15 text-warn' },
  READY_TO_SEND: { label: 'جاهز للإرسال', cls: 'bg-teal/12 text-teal' },
  COMPLETED: { label: 'مكتمل', cls: 'bg-ok/12 text-ok' },
  REJECTED: { label: 'مرفوض', cls: 'bg-bad/12 text-bad' },
  CANCELLED: { label: 'ملغي', cls: 'surface-2 text-muted' },
};

export const NETWORK_LABEL: Record<UsdtNetwork, string> = {
  TRC20: 'TRC20 · TRON',
  BEP20: 'BEP20 · BNB Smart Chain',
  ERC20: 'ERC20 · Ethereum',
};

export const ACTION_LABEL: Record<string, string> = {
  created: 'أنشأ الزبون الطلب',
  'proof.attached': 'أرفق الزبون صورة التحويل',
  'payment.submitted': 'أبلغ الزبون عن التحويل',
  'payment.updated': 'صحّح الزبون بيانات التحويل',
  approved: 'تأكيد وصول المبلغ',
  completed: 'سُجّل الإرسال (TXID)',
  rejected: 'رُفض الطلب',
  cancelled: 'ألغى الزبون الطلب',
  expired: 'انتهت مهلة الدفع (تلقائي)',
};

/** The same TXID formats the API accepts, so the owner sees a mistake before sending. */
export function txidProblem(order: Pick<UsdtOrderRow, 'delivery' | 'network'>, txid: string): string | null {
  const v = txid.trim();
  if (!v) return 'اكتب رقم العملية.';
  if (order.delivery === 'BINANCE') return /^[A-Za-z0-9-]{6,64}$/.test(v) ? null : 'رقم تحويل Binance: من 6 إلى 64 حرفًا أو رقمًا.';
  if (order.network === 'TRC20') return /^[0-9a-fA-F]{64}$/.test(v) ? null : 'رقم عملية TRON: 64 حرفًا من 0-9 وa-f، بدون 0x.';
  return /^0x[0-9a-fA-F]{64}$/.test(v) ? null : 'رقم العملية على هذه الشبكة: 0x ثم 64 حرفًا من 0-9 وa-f.';
}
