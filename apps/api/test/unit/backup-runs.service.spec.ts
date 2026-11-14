import { randomBytes, randomUUID } from 'crypto';
import { BackupFile } from '../../src/modules/admin-tools/backup.service';
import {
  BackupRunsService, dailySlot, DEFAULT_SCHEDULE, MAX_TRIES_PER_SLOT, weeklySlot,
} from '../../src/modules/admin-tools/backup-runs.service';
import { decryptBackup, encryptWithPassphrase, sha256Hex } from '../../src/modules/admin-tools/backup-crypto';
import { BACKUP_TICK_JOB, BackupProcessor } from '../../src/modules/queues/processors/backup.processor';

type Run = { id: string; trigger: string; status: string; startedAt: Date; [k: string]: unknown };

const FILE: BackupFile = {
  version: 3,
  exportedAt: '2026-10-20T08:15:30.000Z',
  counts: { currency: 1, user: 2 },
  tables: { currency: [{ code: 'USD' }], user: [{ id: 'a' }, { id: 'b' }] },
};

function setup(env: Record<string, string | undefined> = {}) {
  const runs: Run[] = [];
  const settings = new Map<string, unknown>();
  const prisma = {
    backupRun: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const run = { id: `run-${runs.length + 1}`, status: 'RUNNING', startedAt: new Date(), ...data } as Run;
        runs.push(run);
        return Promise.resolve(run);
      }),
      update: jest.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const run = runs.find((r) => r.id === where.id)!;
        Object.assign(run, data);
        return Promise.resolve(run);
      }),
      findMany: jest.fn(({ where, take }: { where?: { trigger: string; startedAt: { gte: Date } }; take?: number }) =>
        Promise.resolve(
          runs
            .filter((r) => !where || (r.trigger === where.trigger && r.startedAt >= where.startedAt.gte))
            .slice(0, take ?? runs.length),
        )),
      findFirst: jest.fn(({ where }: { where?: { status: string } } = {}) =>
        Promise.resolve([...runs].reverse().find((r) => !where || r.status === where.status) ?? null)),
    },
    systemSetting: {
      findUnique: jest.fn(({ where }: { where: { key: string } }) =>
        Promise.resolve(settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null)),
      upsert: jest.fn(({ where, create }: { where: { key: string }; create: { value: unknown } }) => {
        settings.set(where.key, create.value);
        return Promise.resolve({});
      }),
    },
  };
  const backups = { export: jest.fn(() => Promise.resolve({ ...FILE, exportedAt: FILE.exportedAt })) };
  const drive = {
    assertConfigured: jest.fn(),
    status: jest.fn(() =>
      Promise.resolve({ configured: true, missing: [] as string[], connected: true, account: { email: 'o@g.test', connectedAt: 'x' } as unknown })),
    upload: jest.fn<Promise<{ id: string; name: string }>, [string, Buffer, string]>(() => Promise.resolve({ id: 'drive-file-1', name: 'n' })),
    prune: jest.fn(() => Promise.resolve(['old-1'])),
  };
  const notices = { notify: jest.fn(() => Promise.resolve(null)), resolve: jest.fn(() => Promise.resolve()) };
  const audit = { recordAsync: jest.fn(() => Promise.resolve()) };
  const key = randomBytes(32).toString('hex');
  const values: Record<string, string | undefined> = { BACKUP_ENCRYPTION_KEY: key, ...env };
  const config = { get: jest.fn((k: string) => values[k]) };
  const service = new BackupRunsService(prisma as never, backups as never, drive as never, notices as never, audit as never, config as never);
  return { service, runs, settings, prisma, backups, drive, notices, audit, key };
}

const errCode = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'no error';
  } catch (e) {
    return ((e as { getResponse?: () => { error?: string } }).getResponse?.() ?? {}).error ?? (e as Error).message;
  }
};

describe('BackupRunsService', () => {
  describe('the run log', () => {
    it('logs a download with its size, SHA-256 and rows, and closes the failure notice', async () => {
      const s = setup();
      const out = await s.service.plainDownload('owner-1');

      expect(out.filename).toBe('patron-backup-2026-10-20T08-15-30.json');
      expect(JSON.parse(out.body.toString())).toEqual(FILE);
      expect(s.runs).toHaveLength(1);
      expect(s.runs[0]).toMatchObject({
        trigger: 'download', destination: 'download', encrypted: false, triggeredById: 'owner-1', status: 'SUCCEEDED',
        sizeBytes: out.body.length, sha256: sha256Hex(out.body), counts: FILE.counts,
      });
      expect(s.runs[0].finishedAt).toBeInstanceOf(Date);
      expect(s.notices.resolve).toHaveBeenCalledWith('backup.failed');
      expect(s.settings.get('backup.last_downloaded_at')).toBe(FILE.exportedAt);
    });

    it('logs a failure, raises one urgent notice and rethrows', async () => {
      const s = setup();
      s.backups.export.mockRejectedValueOnce(new Error('database\nunreachable'));
      await expect(s.service.plainDownload('owner-1')).rejects.toThrow('unreachable');

      expect(s.runs[0]).toMatchObject({ status: 'FAILED', error: 'database unreachable' });
      expect(s.notices.notify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'backup.failed', priority: 'URGENT', dedupeKey: 'backup.failed', link: '/settings#backup', entityId: 'run-1',
      }));
      expect(s.notices.resolve).not.toHaveBeenCalled();
      expect(s.settings.has('backup.last_downloaded_at')).toBe(false);
    });

    it('keeps going when the log row cannot be closed or the notice cannot be resolved', async () => {
      const s = setup();
      s.notices.resolve.mockRejectedValueOnce(new Error('inbox down'));
      await expect(s.service.plainDownload()).resolves.toBeDefined();

      s.backups.export.mockRejectedValueOnce(new Error('boom'));
      s.prisma.backupRun.update.mockRejectedValueOnce(new Error('db gone'));
      await expect(s.service.plainDownload()).rejects.toThrow('boom');
      expect(s.notices.notify).toHaveBeenCalled();
    });

    it('lists the latest runs, at most 100', async () => {
      const s = setup();
      await s.service.runs(500);
      expect(s.prisma.backupRun.findMany).toHaveBeenLastCalledWith({ orderBy: { startedAt: 'desc' }, take: 100 });
      await s.service.runs();
      expect(s.prisma.backupRun.findMany).toHaveBeenLastCalledWith({ orderBy: { startedAt: 'desc' }, take: 30 });
    });
  });

  it('locks a download with the passphrase: the file opens with it and holds no readable data', async () => {
    const s = setup();
    const passphrase = `test-${randomUUID()}`;
    const out = await s.service.encryptedDownload(passphrase, 'owner-1');

    expect(out.filename).toBe('patron-backup-2026-10-20T08-15-30.patronbak');
    expect(out.body.toString('latin1')).not.toContain('currency');
    expect(out.body.toString('latin1')).not.toContain(passphrase);
    expect(JSON.parse((await decryptBackup(out.body, { passphrase })).toString())).toEqual(FILE);
    expect(s.runs[0]).toMatchObject({ encrypted: true, status: 'SUCCEEDED', sha256: sha256Hex(out.body) });
    expect(s.audit.recordAsync).toHaveBeenCalledWith(expect.objectContaining({ action: 'backup.download.encrypted' }));
    expect(JSON.stringify(s.audit.recordAsync.mock.calls)).not.toContain(passphrase);
  });

  describe('Google Drive', () => {
    it('uploads a copy encrypted with BACKUP_ENCRYPTION_KEY and trims old ones', async () => {
      const s = setup();
      s.settings.set('backup.schedule', { ...DEFAULT_SCHEDULE, keep: 4 });
      const res = await s.service.toDrive('scheduled_daily');

      const [name, bytes, kind] = s.drive.upload.mock.calls[0];
      expect(name).toBe('patron-backup-daily-2026-10-20T08-15-30.patronbak');
      expect(kind).toBe('daily');
      expect(JSON.parse((await decryptBackup(bytes, { keyHex: s.key })).toString())).toEqual(FILE);
      expect(s.drive.prune).toHaveBeenCalledWith('daily', 4);
      expect(res.trashed).toBe(1);
      expect(s.runs[0]).toMatchObject({ trigger: 'scheduled_daily', destination: 'google_drive', encrypted: true, remoteId: 'drive-file-1', status: 'SUCCEEDED' });
    });

    it('fails (logged and notified) without a usable key, and says which', async () => {
      const missing = setup({ BACKUP_ENCRYPTION_KEY: undefined });
      expect(await errCode(missing.service.toDrive('scheduled_weekly'))).toBe('BACKUP_KEY_NOT_CONFIGURED');
      expect(missing.runs[0]).toMatchObject({ status: 'FAILED', error: 'BACKUP_ENCRYPTION_KEY is not set on the server' });
      expect(missing.notices.notify).toHaveBeenCalled();
      expect(missing.drive.upload).not.toHaveBeenCalled();

      const invalid = setup({ BACKUP_ENCRYPTION_KEY: 'nope' });
      await expect(invalid.service.toDrive('manual_drive')).rejects.toThrow('not 64 hex');
      expect(invalid.service.backupKey()).toEqual({ key: null, problem: 'invalid' });
    });

    it('a failed trim does not undo a good copy', async () => {
      const s = setup();
      s.drive.prune.mockRejectedValueOnce(new Error('quota'));
      await expect(s.service.toDrive('manual_drive')).resolves.toMatchObject({ trashed: 0 });
      expect(s.runs[0].status).toBe('SUCCEEDED');
    });

    it('"send now" is audited', async () => {
      const s = setup();
      await s.service.sendToDriveNow('owner-1');
      expect(s.drive.upload.mock.calls[0][2]).toBe('manual');
      expect(s.audit.recordAsync).toHaveBeenCalledWith(expect.objectContaining({ action: 'backup.drive.run', actorId: 'owner-1', entityId: 'run-1' }));
    });
  });

  describe('schedule', () => {
    it('starts switched off and keeps what is saved', async () => {
      const s = setup();
      await expect(s.service.schedule()).resolves.toEqual(DEFAULT_SCHEDULE);
      s.settings.set('backup.schedule', { daily: true, hourUtc: 23, weekday: 'x', keep: 3 });
      await expect(s.service.schedule()).resolves.toEqual({ daily: true, weekly: false, hourUtc: 23, weekday: DEFAULT_SCHEDULE.weekday, keep: 3 });
    });

    it('switching a copy on needs the key, Drive settings and a connection; switching off never does', async () => {
      const noKey = setup({ BACKUP_ENCRYPTION_KEY: undefined });
      expect(await errCode(noKey.service.setSchedule({ daily: true }, 'o'))).toBe('BACKUP_KEY_NOT_CONFIGURED');

      const s = setup();
      s.drive.status.mockResolvedValueOnce({ configured: true, missing: [], connected: false, account: null });
      expect(await errCode(s.service.setSchedule({ weekly: true }, 'o'))).toBe('GDRIVE_NOT_CONNECTED');

      await expect(s.service.setSchedule({ daily: true, hourUtc: 4, keep: 10, weekday: undefined }, 'o')).resolves.toEqual({
        ...DEFAULT_SCHEDULE, daily: true, hourUtc: 4, keep: 10,
      });
      expect(s.audit.recordAsync).toHaveBeenCalledWith(expect.objectContaining({ action: 'backup.schedule.update', entityId: 'backup.schedule' }));

      // already on: changing the hour does not re-check
      s.drive.status.mockClear();
      await s.service.setSchedule({ hourUtc: 5 }, 'o');
      expect(s.drive.status).not.toHaveBeenCalled();
      await expect(noKey.service.setSchedule({ daily: false, weekly: false }, 'o')).resolves.toMatchObject({ daily: false });
    });

    it('finds the latest daily and weekly slots', () => {
      const now = new Date('2026-10-20T08:30:00Z'); // a Tuesday
      expect(dailySlot(now, 2).toISOString()).toBe('2026-10-20T02:00:00.000Z');
      expect(dailySlot(now, 9).toISOString()).toBe('2026-10-19T09:00:00.000Z');
      expect(weeklySlot(now, 2, 8).toISOString()).toBe('2026-10-20T08:00:00.000Z');
      expect(weeklySlot(now, 2, 9).toISOString()).toBe('2026-10-13T09:00:00.000Z');
      expect(weeklySlot(now, 5, 2).toISOString()).toBe('2026-10-16T02:00:00.000Z');
      expect(weeklySlot(now, 3, 0).toISOString()).toBe('2026-10-14T00:00:00.000Z');
    });

    it('plans the next copies', () => {
      const s = setup();
      const now = new Date('2026-10-20T08:30:00Z');
      expect(s.service.nextRuns({ ...DEFAULT_SCHEDULE, daily: true, weekly: true, hourUtc: 2, weekday: 5 }, now)).toEqual({
        daily: '2026-10-21T02:00:00.000Z', weekly: '2026-10-23T02:00:00.000Z',
      });
      expect(s.service.nextRuns(DEFAULT_SCHEDULE, now)).toEqual({ daily: null, weekly: null });
    });
  });

  describe('tick', () => {
    const now = new Date('2026-10-20T08:30:00Z');
    const run = (trigger: string, status: string, startedAt: string): Run => ({ id: randomUUID(), trigger, status, startedAt: new Date(startedAt) });

    it('does nothing while the schedule is off', async () => {
      const s = setup();
      await expect(s.service.tick(now)).resolves.toEqual({ ran: [] });
      expect(s.drive.upload).not.toHaveBeenCalled();
    });

    it('runs each copy once per slot, catching up after the server slept', async () => {
      const s = setup();
      s.settings.set('backup.schedule', { daily: true, weekly: true, hourUtc: 2, weekday: 2, keep: 7 });
      s.runs.push(run('scheduled_daily', 'SUCCEEDED', '2026-10-19T02:05:00Z')); // yesterday's
      await expect(s.service.tick(now)).resolves.toEqual({ ran: ['scheduled_weekly', 'scheduled_daily'] });
      await expect(s.service.tick(now)).resolves.toEqual({ ran: [] });
    });

    it('retries a failed slot a few times, not forever, and leaves a running one alone', async () => {
      const s = setup();
      s.settings.set('backup.schedule', { daily: true, weekly: false, hourUtc: 2, weekday: 0, keep: 7 });
      s.drive.upload.mockRejectedValue(new Error('Drive down'));
      for (let i = 0; i < MAX_TRIES_PER_SLOT; i++) {
        await expect(s.service.tick(now)).resolves.toEqual({ ran: ['scheduled_daily:failed'] });
      }
      await expect(s.service.tick(now)).resolves.toEqual({ ran: [] });

      const busy = setup();
      busy.settings.set('backup.schedule', { daily: true, weekly: false, hourUtc: 2, weekday: 0, keep: 7 });
      busy.runs.push(run('scheduled_daily', 'RUNNING', '2026-10-20T08:00:00Z'));
      await expect(busy.service.tick(now)).resolves.toEqual({ ran: [] });
      // cut off by a restart long ago: tried again
      busy.runs[0].startedAt = new Date('2026-10-20T02:01:00Z');
      await expect(busy.service.tick(now)).resolves.toEqual({ ran: ['scheduled_daily'] });
    });

    it('is what the BullMQ job runs', async () => {
      const runs = { tick: jest.fn(() => Promise.resolve({ ran: [] })) };
      const p = new BackupProcessor(runs as never);
      await expect(p.process({ name: BACKUP_TICK_JOB } as never)).resolves.toEqual({ ran: [] });
      expect(() => p.process({ name: 'other' } as never)).toThrow('Unknown backups job "other"');
    });
  });

  it('gives the dashboard one overview', async () => {
    const s = setup({ BACKUP_ENCRYPTION_KEY: undefined });
    s.settings.set('backup.last_downloaded_at', '2026-10-19T00:00:00.000Z');
    s.runs.push({ id: 'r1', trigger: 'download', status: 'SUCCEEDED', startedAt: new Date('2026-10-19T00:00:00Z'), finishedAt: new Date('2026-10-19T00:00:05Z') });
    s.runs.push({ id: 'r2', trigger: 'scheduled_daily', status: 'FAILED', startedAt: new Date('2026-10-20T02:00:00Z') });
    const o = await s.service.overview();
    expect(o).toMatchObject({
      backupKey: { configured: false, problem: 'missing' },
      drive: { connected: true },
      schedule: DEFAULT_SCHEDULE,
      nextRuns: { daily: null, weekly: null },
      lastRun: { id: 'r2' },
      lastSuccessAt: new Date('2026-10-19T00:00:05Z'),
      lastDownloadAt: '2026-10-19T00:00:00.000Z',
    });
  });

  describe('verify', () => {
    it('checks a plain file and counts its rows, writing nothing', async () => {
      const s = setup();
      const bytes = Buffer.from(JSON.stringify(FILE));
      await expect(s.service.verify(bytes)).resolves.toMatchObject({
        ok: true, encrypted: false, version: 3, totalRows: 3, sizeBytes: bytes.length, sha256: sha256Hex(bytes), problems: [],
      });
      expect(s.prisma.backupRun.create).not.toHaveBeenCalled();
      expect(s.prisma.systemSetting.upsert).not.toHaveBeenCalled();
    });

    it('opens a passphrase file, and a scheduled copy with this server key', async () => {
      const s = setup();
      const passphrase = `test-${randomUUID()}`;
      const locked = await encryptWithPassphrase(Buffer.from(JSON.stringify(FILE)), passphrase, { N: 2 ** 14, r: 8, p: 1 });
      await expect(s.service.verify(locked, passphrase)).resolves.toMatchObject({ ok: true, encrypted: true, counts: { user: 2 } });
      expect(await errCode(s.service.verify(locked, `${passphrase}!`))).toBe('WRONG_PASSPHRASE_OR_DAMAGED');
      expect(await errCode(s.service.verify(locked))).toBe('PASSPHRASE_REQUIRED');

      await s.service.toDrive('manual_drive');
      const scheduled = s.drive.upload.mock.calls[0][1];
      await expect(s.service.verify(scheduled)).resolves.toMatchObject({ ok: true, encrypted: true });
      expect(await errCode(setup().service.verify(scheduled))).toBe('WRONG_KEY');
      const badKey = setup({ BACKUP_ENCRYPTION_KEY: 'zz' });
      await expect(badKey.service.verify(scheduled)).rejects.toThrow('on this server is not 64 hex');
    });

    it('reports what is wrong with a file that would not restore', async () => {
      const s = setup();
      const res = await s.service.verify(Buffer.from(JSON.stringify({ version: 1, tables: {} })));
      expect(res.ok).toBe(false);
      expect(res.problems[0]).toContain('found version 1');
      expect(await errCode(s.service.verify(Buffer.from('not a backup')))).toBe('NOT_A_BACKUP');
    });
  });
});
