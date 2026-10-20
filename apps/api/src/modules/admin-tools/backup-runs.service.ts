import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BackupRun, Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { StaffNotificationsService } from '../staff-notifications/staff-notifications.service';
import { BackupFile, BackupService, inspectBackup } from './backup.service';
import {
  BackupCryptoError, encryptWithKey, encryptWithPassphrase, parseBackupKey, PATRONBAK_EXT, readBackupFile, sha256Hex,
} from './backup-crypto';
import { DriveFileKind, GoogleDriveService } from './google-drive.service';

/** Where a run came from: a download in the dashboard, a schedule, or "send to Drive now". */
export type BackupTrigger = 'download' | 'scheduled_daily' | 'scheduled_weekly' | 'manual_drive';
export type BackupDestination = 'download' | 'google_drive';

/** System setting holding when the owner last downloaded a full backup. */
export const LAST_DOWNLOAD_KEY = 'backup.last_downloaded_at';
/** System setting holding the Drive schedule. */
export const SCHEDULE_KEY = 'backup.schedule';
/** Notice raised when a backup fails, closed by the next one that works. */
export const BACKUP_FAILED_KEY = 'backup.failed';
/** A scheduled copy is tried this many times per slot (once per tick), then waits for the next slot. */
export const MAX_TRIES_PER_SLOT = 3;
/** A run still RUNNING after this long was cut off (restart, crash): the slot may be tried again. */
const STALE_RUN_MS = 2 * 3600_000;

export interface BackupSchedule {
  daily: boolean;
  weekly: boolean;
  hourUtc: number;
  /** 0 Sunday … 6 Saturday. */
  weekday: number;
  /** Copies of each kind kept in the Drive. */
  keep: number;
}

export const DEFAULT_SCHEDULE: BackupSchedule = { daily: false, weekly: false, hourUtc: 2, weekday: 5, keep: 7 };

const KIND: Record<'scheduled_daily' | 'scheduled_weekly' | 'manual_drive', DriveFileKind> = {
  scheduled_daily: 'daily',
  scheduled_weekly: 'weekly',
  manual_drive: 'manual',
};

/** The latest daily slot at or before `now`. */
export function dailySlot(now: Date, hourUtc: number): Date {
  const slot = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc));
  if (slot > now) slot.setUTCDate(slot.getUTCDate() - 1);
  return slot;
}

/** The latest weekly slot (that weekday, that hour) at or before `now`. */
export function weeklySlot(now: Date, weekday: number, hourUtc: number): Date {
  const slot = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc));
  slot.setUTCDate(slot.getUTCDate() - ((slot.getUTCDay() - weekday + 7) % 7));
  if (slot > now) slot.setUTCDate(slot.getUTCDate() - 7);
  return slot;
}

const stamp = (iso: string) => iso.slice(0, 19).replace(/:/g, '-');
/** A run's error as stored and shown: one line, short, and never a secret (we only ever put messages in). */
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 500);

/**
 * Every backup attempt, wherever it goes, is a BackupRun row: when, how it was
 * triggered, where it went, whether it was encrypted, its size and SHA-256, the
 * rows per table, and the error if it failed. A failure raises one urgent
 * notice in the owner's inbox (always the same one, so failures do not stack);
 * the next backup that works closes it.
 *
 * Scheduled copies go to Google Drive, encrypted with BACKUP_ENCRYPTION_KEY. A
 * tick every 15 minutes (BullMQ, see QueuesModule) asks whether the current
 * daily or weekly slot already has a copy; this catches up after the free
 * server slept through the hour, and changing the schedule needs no job change.
 */
@Injectable()
export class BackupRunsService {
  private readonly log = new Logger(BackupRunsService.name);

  constructor(
    private prisma: PrismaService,
    private backups: BackupService,
    private drive: GoogleDriveService,
    private notices: StaffNotificationsService,
    private audit: AuditService,
    private config: ConfigService,
  ) {}

  // ─── keys ───

  /** BACKUP_ENCRYPTION_KEY, or why it cannot be used. */
  backupKey(): { key: Buffer | null; problem: 'missing' | 'invalid' | null } {
    try {
      const key = parseBackupKey(this.config.get<string>('BACKUP_ENCRYPTION_KEY'));
      return { key, problem: key ? null : 'missing' };
    } catch {
      return { key: null, problem: 'invalid' };
    }
  }

  private requireBackupKey(): Buffer {
    const { key, problem } = this.backupKey();
    if (!key) {
      throw new BadRequestException({
        error: 'BACKUP_KEY_NOT_CONFIGURED',
        message: problem === 'invalid'
          ? 'BACKUP_ENCRYPTION_KEY is set but is not 64 hex characters'
          : 'BACKUP_ENCRYPTION_KEY is not set on the server',
        missing: ['BACKUP_ENCRYPTION_KEY'],
      });
    }
    return key;
  }

  // ─── the run log ───

  /**
   * Run one backup attempt and log it. `work` returns the bytes that left the
   * server (to hash and measure) and the rows per table.
   */
  async track<T extends { bytes: Buffer; file: BackupFile; remoteId?: string }>(
    meta: { trigger: BackupTrigger; destination: BackupDestination; encrypted: boolean; actorId?: string | null },
    work: () => Promise<T>,
  ): Promise<T & { run: BackupRun }> {
    const started = await this.prisma.backupRun.create({
      data: { trigger: meta.trigger, destination: meta.destination, encrypted: meta.encrypted, triggeredById: meta.actorId ?? null },
    });
    try {
      const out = await work();
      const run = await this.prisma.backupRun.update({
        where: { id: started.id },
        data: {
          status: 'SUCCEEDED',
          sizeBytes: out.bytes.length,
          sha256: sha256Hex(out.bytes),
          remoteId: out.remoteId ?? null,
          counts: out.file.counts as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });
      try {
        await this.notices.resolve(BACKUP_FAILED_KEY);
      } catch (e) {
        this.log.warn(`could not close the backup notice: ${errorText(e)}`);
      }
      return { ...out, run };
    } catch (e) {
      const error = errorText(e);
      await this.prisma.backupRun
        .update({ where: { id: started.id }, data: { status: 'FAILED', error, finishedAt: new Date() } })
        .catch((err: unknown) => this.log.error(`backup run ${started.id} not marked failed: ${errorText(err)}`));
      await this.notices.notify({
        type: 'backup.failed',
        priority: 'URGENT',
        dedupeKey: BACKUP_FAILED_KEY,
        title: 'فشل النسخ الاحتياطي',
        body: `لم تكتمل النسخة الاحتياطية (${this.describe(meta.trigger)}): ${error}`,
        link: '/settings#backup',
        entityType: 'BackupRun',
        entityId: started.id,
        data: { trigger: meta.trigger, destination: meta.destination },
      });
      this.log.error(`backup ${meta.trigger} → ${meta.destination} failed: ${error}`);
      throw e;
    }
  }

  private describe(trigger: BackupTrigger) {
    return {
      download: 'تنزيل من لوحة التحكم',
      scheduled_daily: 'النسخة اليومية إلى Google Drive',
      scheduled_weekly: 'النسخة الأسبوعية إلى Google Drive',
      manual_drive: 'إرسال يدوي إلى Google Drive',
    }[trigger];
  }

  /** The latest attempts, newest first. */
  runs(limit = 30) {
    return this.prisma.backupRun.findMany({ orderBy: { startedAt: 'desc' }, take: Math.min(Math.max(limit, 1), 100) });
  }

  // ─── downloads ───

  /** When the owner last took a copy home, so the dashboard can remind them. */
  private async rememberDownload(exportedAt: string) {
    await this.prisma.systemSetting.upsert({
      where: { key: LAST_DOWNLOAD_KEY },
      update: { value: exportedAt },
      create: { key: LAST_DOWNLOAD_KEY, value: exportedAt, group: 'backup', description: 'When the owner last downloaded a full backup' },
    });
  }

  /** The plain JSON download (GET /admin/backup), logged. */
  async plainDownload(actorId?: string | null) {
    const out = await this.track({ trigger: 'download', destination: 'download', encrypted: false, actorId }, async () => {
      const file = await this.backups.export();
      return { file, bytes: Buffer.from(JSON.stringify(file), 'utf8') };
    });
    await this.rememberDownload(out.file.exportedAt);
    return { filename: `patron-backup-${stamp(out.file.exportedAt)}.json`, body: out.bytes, file: out.file, run: out.run };
  }

  /** The same backup locked with the owner's passphrase (`.patronbak`). */
  async encryptedDownload(passphrase: string, actorId?: string | null) {
    const out = await this.track({ trigger: 'download', destination: 'download', encrypted: true, actorId }, async () => {
      const file = await this.backups.export();
      return { file, bytes: await encryptWithPassphrase(Buffer.from(JSON.stringify(file), 'utf8'), passphrase) };
    });
    await this.rememberDownload(out.file.exportedAt);
    await this.audit.recordAsync({ actorId: actorId ?? undefined, action: 'backup.download.encrypted', entityType: 'BackupRun', entityId: out.run.id });
    return { filename: `patron-backup-${stamp(out.file.exportedAt)}${PATRONBAK_EXT}`, body: out.bytes, file: out.file, run: out.run };
  }

  // ─── Google Drive ───

  /** Export, encrypt with BACKUP_ENCRYPTION_KEY, upload, then trim old copies of the same kind. */
  async toDrive(trigger: 'scheduled_daily' | 'scheduled_weekly' | 'manual_drive', actorId?: string | null) {
    const kind = KIND[trigger];
    const out = await this.track({ trigger, destination: 'google_drive', encrypted: true, actorId }, async () => {
      const key = this.requireBackupKey();
      this.drive.assertConfigured();
      const file = await this.backups.export();
      const bytes = await encryptWithKey(Buffer.from(JSON.stringify(file), 'utf8'), key);
      const uploaded = await this.drive.upload(`patron-backup-${kind}-${stamp(file.exportedAt)}${PATRONBAK_EXT}`, bytes, kind);
      return { file, bytes, remoteId: uploaded.id };
    });
    // retention is housekeeping: a failure here does not undo a good copy
    let trashed: string[] = [];
    try {
      trashed = await this.drive.prune(kind, (await this.schedule()).keep);
    } catch (e) {
      this.log.warn(`old ${kind} copies not trimmed: ${errorText(e)}`);
    }
    return { run: out.run, trashed: trashed.length };
  }

  async sendToDriveNow(actorId: string) {
    const res = await this.toDrive('manual_drive', actorId);
    await this.audit.recordAsync({ actorId, action: 'backup.drive.run', entityType: 'BackupRun', entityId: res.run.id });
    return res;
  }

  // ─── schedule ───

  async schedule(): Promise<BackupSchedule> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: SCHEDULE_KEY } });
    const v = (row?.value && typeof row.value === 'object' ? row.value : {}) as Partial<BackupSchedule>;
    return {
      daily: v.daily === true,
      weekly: v.weekly === true,
      hourUtc: Number.isInteger(v.hourUtc) ? Number(v.hourUtc) : DEFAULT_SCHEDULE.hourUtc,
      weekday: Number.isInteger(v.weekday) ? Number(v.weekday) : DEFAULT_SCHEDULE.weekday,
      keep: Number.isInteger(v.keep) ? Number(v.keep) : DEFAULT_SCHEDULE.keep,
    };
  }

  /** Change the schedule. Switching a copy on needs the key and a connected Drive first. */
  async setSchedule(patch: Partial<BackupSchedule>, actorId: string): Promise<BackupSchedule> {
    const before = await this.schedule();
    const next: BackupSchedule = { ...before, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
    if ((next.daily && !before.daily) || (next.weekly && !before.weekly)) {
      this.requireBackupKey();
      this.drive.assertConfigured();
      if (!(await this.drive.status()).connected) {
        throw new BadRequestException({ error: 'GDRIVE_NOT_CONNECTED', message: 'Connect Google Drive before switching on scheduled backups' });
      }
    }
    await this.prisma.systemSetting.upsert({
      where: { key: SCHEDULE_KEY },
      update: { value: next as unknown as Prisma.InputJsonValue },
      create: { key: SCHEDULE_KEY, value: next as unknown as Prisma.InputJsonValue, group: 'backup', description: 'Scheduled backups to Google Drive' },
    });
    await this.audit.recordAsync({ actorId, action: 'backup.schedule.update', entityType: 'SystemSetting', entityId: SCHEDULE_KEY, before, after: next });
    return next;
  }

  /** Does this slot still need a copy? Not if one worked or is running, or it failed too often. */
  private async due(trigger: BackupTrigger, slot: Date, now: Date): Promise<boolean> {
    const runs = await this.prisma.backupRun.findMany({
      where: { trigger, startedAt: { gte: slot } },
      select: { status: true, startedAt: true },
    });
    if (runs.some((r) => r.status === 'SUCCEEDED')) return false;
    if (runs.some((r) => r.status === 'RUNNING' && now.getTime() - r.startedAt.getTime() < STALE_RUN_MS)) return false;
    return runs.filter((r) => r.status === 'FAILED').length < MAX_TRIES_PER_SLOT;
  }

  /** The scheduler's tick: run whichever scheduled copy is due. Never throws (failures are logged and notified). */
  async tick(now = new Date()) {
    const s = await this.schedule();
    const ran: string[] = [];
    const plan: Array<['scheduled_daily' | 'scheduled_weekly', boolean, Date]> = [
      ['scheduled_weekly', s.weekly, weeklySlot(now, s.weekday, s.hourUtc)],
      ['scheduled_daily', s.daily, dailySlot(now, s.hourUtc)],
    ];
    for (const [trigger, on, slot] of plan) {
      if (!on || !(await this.due(trigger, slot, now))) continue;
      try {
        await this.toDrive(trigger);
        ran.push(trigger);
      } catch {
        ran.push(`${trigger}:failed`);
      }
    }
    return { ran };
  }

  /** The next time each enabled copy is planned (for the dashboard). */
  nextRuns(s: BackupSchedule, now = new Date()) {
    const next = (slot: Date, days: number) => {
      const d = new Date(slot);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString();
    };
    return {
      daily: s.daily ? next(dailySlot(now, s.hourUtc), 1) : null,
      weekly: s.weekly ? next(weeklySlot(now, s.weekday, s.hourUtc), 7) : null,
    };
  }

  // ─── the dashboard's view ───

  async overview() {
    const [drive, schedule, last, lastOk, lastDownload] = await Promise.all([
      this.drive.status(),
      this.schedule(),
      this.prisma.backupRun.findFirst({ orderBy: { startedAt: 'desc' } }),
      this.prisma.backupRun.findFirst({ where: { status: 'SUCCEEDED' }, orderBy: { startedAt: 'desc' } }),
      this.prisma.systemSetting.findUnique({ where: { key: LAST_DOWNLOAD_KEY } }),
    ]);
    const key = this.backupKey();
    return {
      backupKey: { configured: !!key.key, problem: key.problem },
      drive,
      schedule,
      nextRuns: this.nextRuns(schedule),
      lastRun: last,
      lastSuccessAt: lastOk?.finishedAt ?? lastOk?.startedAt ?? null,
      lastDownloadAt: typeof lastDownload?.value === 'string' ? lastDownload.value : null,
    };
  }

  // ─── verification ───

  /**
   * Open a backup file the way a restore would — decrypt it (passphrase, or this
   * server's BACKUP_ENCRYPTION_KEY), parse it, check the version and the rows
   * per table — and write nothing at all.
   */
  async verify(bytes: Buffer, passphrase?: string) {
    try {
      const { encrypted, data } = await readBackupFile(bytes, {
        passphrase: passphrase || null,
        keyHex: this.config.get<string>('BACKUP_ENCRYPTION_KEY') ?? null,
      });
      return { encrypted, sizeBytes: bytes.length, sha256: sha256Hex(bytes), ...inspectBackup(data) };
    } catch (e) {
      if (e instanceof BackupCryptoError) {
        const message = e.code === 'BACKUP_KEY_INVALID' ? 'BACKUP_ENCRYPTION_KEY on this server is not 64 hex characters' : e.message;
        throw new BadRequestException({ error: e.code, message });
      }
      throw e;
    }
  }
}
