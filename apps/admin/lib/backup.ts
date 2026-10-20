/**
 * Client for the backup centre (`/admin/backup/*`): encrypted downloads, Google
 * Drive, the schedule, the log and verification. Kept apart from lib/api.ts
 * because these calls send files and passphrases, receive files, and need the
 * server's stable error code to explain what to do.
 */
import { api, ApiError, getAccess, NOT_READY } from './api';

const BASE = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ?? 'http://localhost:3000/api/v1';

export type BackupStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED';
export type BackupTrigger = 'download' | 'scheduled_daily' | 'scheduled_weekly' | 'manual_drive';

export type BackupRun = {
  id: string;
  trigger: BackupTrigger | string;
  destination: 'download' | 'google_drive' | string;
  status: BackupStatus;
  encrypted: boolean;
  sizeBytes: number | null;
  sha256: string | null;
  remoteId: string | null;
  counts: Record<string, number> | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type BackupSchedule = { daily: boolean; weekly: boolean; hourUtc: number; weekday: number; keep: number };

export type BackupOverview = {
  backupKey: { configured: boolean; problem: 'missing' | 'invalid' | null };
  drive: {
    configured: boolean;
    missing: string[];
    connected: boolean;
    account: { email: string | null; connectedAt: string } | null;
  };
  schedule: BackupSchedule;
  nextRuns: { daily: string | null; weekly: string | null };
  lastRun: BackupRun | null;
  lastSuccessAt: string | null;
  lastDownloadAt: string | null;
};

export type VerifyResult = {
  ok: boolean;
  encrypted: boolean;
  version: number | null;
  exportedAt: string | null;
  counts: Record<string, number>;
  totalRows: number;
  problems: string[];
  sizeBytes: number;
  sha256: string;
};

export const OVERVIEW_PATH = '/admin/backup/overview';
export const RUNS_PATH = '/admin/backup/runs?limit=20';
export const MIN_PASSPHRASE = 12;

/** What each stable error code means for the owner. */
const MESSAGES: Record<string, string> = {
  GDRIVE_NOT_CONFIGURED: 'Google Drive غير مُعدّ على الخادم بعد.',
  GDRIVE_NOT_CONNECTED: 'اربط Google Drive أولًا.',
  GDRIVE_STATE_INVALID: 'انتهت صلاحية رابط الربط. اضغط «ربط Google Drive» من جديد.',
  BACKUP_KEY_NOT_CONFIGURED: 'مفتاح النسخ المجدولة (BACKUP_ENCRYPTION_KEY) غير مضبوط على الخادم.',
  BACKUP_KEY_INVALID: 'مفتاح BACKUP_ENCRYPTION_KEY على الخادم غير صالح (يجب أن يكون 64 حرفًا ست عشريًا).',
  PASSPHRASE_TOO_SHORT: `عبارة المرور قصيرة: ${MIN_PASSPHRASE} حرفًا على الأقل.`,
  PASSPHRASE_REQUIRED: 'هذا الملف مقفل بعبارة مرور: اكتبها ثم أعد الفحص.',
  WRONG_PASSPHRASE_OR_DAMAGED: 'عبارة المرور غير صحيحة، أو الملف تالف.',
  KEY_REQUIRED: 'هذه نسخة مجدولة مشفّرة بمفتاح الخادم، والمفتاح غير مضبوط على هذا الخادم.',
  WRONG_KEY: 'هذه النسخة مشفّرة بمفتاح خادم مختلف عن BACKUP_ENCRYPTION_KEY الحالي.',
  NOT_A_BACKUP: 'هذا ليس ملف نسخة احتياطية من Patron.',
  FILE_REQUIRED: 'اختر ملفًا أولًا.',
};

/** An error from the backup routes, with the server's code kept. */
export class BackupError extends ApiError {
  constructor(status: number, message: string, public code?: string) {
    super(status, message);
  }
}

async function toError(res: Response): Promise<BackupError> {
  let body: { error?: string; message?: string | string[]; missing?: string[] } = {};
  try {
    body = await res.json();
  } catch {
    /* not JSON (proxy page) */
  }
  const raw = Array.isArray(body.message) ? body.message.join('، ') : body.message;
  if (res.status === 404 && raw && /^Cannot [A-Z]+ \//.test(raw)) return new BackupError(404, NOT_READY);
  if (res.status === 403) return new BackupError(403, 'ليست لديك صلاحية إدارة النسخ الاحتياطي.');
  if (res.status === 429) return new BackupError(429, 'محاولات كثيرة متتالية. انتظر دقيقة ثم أعد المحاولة.');
  const code = body.error;
  let text = (code && MESSAGES[code]) || raw || `خطأ ${res.status}`;
  if (code === 'GDRIVE_NOT_CONFIGURED' && body.missing?.length) text = `${text} ينقص: ${body.missing.join('، ')}`;
  if (code === 'GDRIVE_ERROR' && raw) text = `خطأ من Google Drive: ${raw}`;
  if (res.status >= 500 && !code) text = `تعذّر الإتمام على الخادم (${res.status}). حاول بعد لحظات.`;
  return new BackupError(res.status, text, code);
}

/** A request with the bearer token; on a 401 the session is refreshed (through api.get) and it is sent once more. */
async function send(method: string, path: string, body?: FormData | object): Promise<Response> {
  const go = () => {
    const token = getAccess();
    const form = typeof FormData !== 'undefined' && body instanceof FormData;
    return fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined && !form ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : form ? (body as FormData) : JSON.stringify(body),
    });
  };
  let res: Response;
  try {
    res = await go();
    if (res.status === 401) {
      await api.get('/auth/me').catch(() => undefined);
      res = await go();
    }
  } catch {
    throw new BackupError(0, 'تعذّر الاتصال بالخادم. تحقّق من الإنترنت ثم أعد المحاولة.');
  }
  if (!res.ok) throw await toError(res);
  return res;
}

async function json<T>(method: string, path: string, body?: FormData | object): Promise<T> {
  return (await send(method, path, body)).json() as Promise<T>;
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The whole shop locked with the owner's passphrase, saved as `.patronbak`. */
export async function downloadEncrypted(passphrase: string): Promise<void> {
  const res = await send('POST', '/admin/backup/encrypted', { passphrase });
  const named = /filename="?([^";]+)"?/i.exec(res.headers.get('content-disposition') ?? '');
  save(await res.blob(), named ? named[1] : `patron-backup-${new Date().toISOString().slice(0, 10)}.patronbak`);
}

/** Check a file (JSON or .patronbak) the way a restore would; the server writes nothing. */
export function verifyBackup(file: File, passphrase?: string): Promise<VerifyResult> {
  const form = new FormData();
  form.append('file', file, file.name);
  if (passphrase) form.append('passphrase', passphrase);
  return json<VerifyResult>('POST', '/admin/backup/verify', form);
}

/** Google's consent page; the owner comes back to `returnTo`. */
export async function driveConsentUrl(returnTo: string): Promise<string> {
  const { url } = await json<{ url: string }>('GET', `/admin/backup/gdrive/connect?returnTo=${encodeURIComponent(returnTo)}`);
  return url;
}

export const disconnectDrive = () => json<{ connected: false }>('POST', '/admin/backup/gdrive/disconnect');
export const sendToDriveNow = () => json<{ run: BackupRun; trashed: number }>('POST', '/admin/backup/gdrive/run');
export const saveSchedule = (patch: Partial<BackupSchedule>) => json<BackupSchedule>('PUT', '/admin/backup/schedule', patch);

/** A rough strength hint for a passphrase (length counts most). */
export function passphraseStrength(p: string): { score: 0 | 1 | 2 | 3; label: string; cls: string } {
  const len = [...p].length;
  if (len < MIN_PASSPHRASE) return { score: 0, label: `قصيرة: ${MIN_PASSPHRASE} حرفًا على الأقل`, cls: 'text-bad' };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/, /\s/, /[^\x00-\x7F]/].filter((r) => r.test(p)).length;
  const words = p.trim().split(/\s+/).length;
  const points = (len >= 16 ? 1 : 0) + (len >= 24 ? 1 : 0) + (kinds >= 3 ? 1 : 0) + (words >= 4 ? 1 : 0);
  if (points >= 3) return { score: 3, label: 'قوية', cls: 'text-ok' };
  if (points >= 1) return { score: 2, label: 'جيدة', cls: 'text-teal' };
  return { score: 1, label: 'مقبولة: أطِلها أو أضف كلمات', cls: 'text-warn' };
}

export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const TRIGGER_LABEL: Record<string, string> = {
  download: 'تنزيل',
  scheduled_daily: 'يومية',
  scheduled_weekly: 'أسبوعية',
  manual_drive: 'إرسال يدوي',
};

export const RUN_STATUS: Record<BackupStatus, { label: string; cls: string }> = {
  SUCCEEDED: { label: 'نجحت', cls: 'bg-ok/12 text-ok' },
  FAILED: { label: 'فشلت', cls: 'bg-bad/12 text-bad' },
  RUNNING: { label: 'جارية', cls: 'bg-warn/12 text-warn' },
};

export const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** Tables the owner recognises, for the verification summary. */
export const TABLE_LABEL: Record<string, string> = {
  user: 'الحسابات',
  wallet: 'المحافظ',
  walletTransaction: 'حركات المحافظ',
  order: 'الطلبات',
  payment: 'المدفوعات',
  refund: 'الاسترجاعات',
  product: 'المنتجات',
  productCode: 'الأكواد',
  agent: 'المندوبون',
  commission: 'العمولات',
  usdtOrder: 'طلبات USDT',
  bankNotification: 'إشعارات البنك',
};
