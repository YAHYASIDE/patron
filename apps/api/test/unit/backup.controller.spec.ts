import { BadRequestException, StreamableFile } from '@nestjs/common';
import { PERMISSIONS_KEY } from '../../src/common/decorators/require-permissions.decorator';
import { IS_PUBLIC_KEY } from '../../src/common/decorators/public.decorator';
import { BackupController } from '../../src/modules/admin-tools/backup.controller';
import { DataExportController } from '../../src/modules/admin-tools/admin-tools.controller';

const meta = (key: string, cls: { prototype: object }, method: string) =>
  Reflect.getMetadata(key, (cls.prototype as Record<string, object>)[method]);

function setup() {
  const runs = {
    overview: jest.fn(() => 'overview'),
    runs: jest.fn(() => 'runs'),
    encryptedDownload: jest.fn(() => Promise.resolve({ filename: 'patron-backup-x.patronbak', body: Buffer.from('LOCKED') })),
    verify: jest.fn(() => 'checked'),
    setSchedule: jest.fn((patch: object) => Promise.resolve({ ...patch })),
    schedule: jest.fn(() => Promise.resolve({ daily: true, weekly: false })),
    sendToDriveNow: jest.fn(() => 'sent'),
  };
  const drive = {
    consentUrl: jest.fn(() => Promise.resolve('https://accounts.google.com/o/oauth2/v2/auth?x')),
    verifyState: jest.fn(() => Promise.resolve({ userId: 'owner-1', returnTo: 'https://admin.shop.test/settings' as string | null })),
    connect: jest.fn(() => Promise.resolve({ email: 'owner@gmail.test' as string | null })),
    disconnect: jest.fn(() => Promise.resolve()),
  };
  const audit = { recordAsync: jest.fn(() => Promise.resolve()) };
  const c = new BackupController(runs as never, drive as never, audit as never);
  const res = () => {
    const r: { [k in 'setHeader' | 'redirect' | 'status' | 'type' | 'send']: jest.Mock } = {
      setHeader: jest.fn(),
      redirect: jest.fn(),
      status: jest.fn(),
      type: jest.fn(),
      send: jest.fn(),
    };
    r.status.mockReturnValue(r);
    r.type.mockReturnValue(r);
    r.send.mockReturnValue(r);
    return r;
  };
  return { c, runs, drive, audit, res };
}

describe('BackupController', () => {
  it('guards every new route with backup.manage and keeps the plain download on settings.manage', () => {
    for (const m of ['overview', 'list', 'encrypted', 'verify', 'schedule', 'connect', 'disconnect', 'runNow']) {
      expect(meta(PERMISSIONS_KEY, BackupController, m)).toEqual(['backup.manage']);
    }
    expect(meta(PERMISSIONS_KEY, DataExportController, 'backup')).toEqual(['settings.manage']);
    expect(meta(PERMISSIONS_KEY, DataExportController, 'backupStatus')).toEqual(['settings.manage']);
    // Google's redirect carries no bearer token: the signed state protects it
    expect(meta(IS_PUBLIC_KEY, BackupController, 'callback')).toBe(true);
    expect(meta(PERMISSIONS_KEY, BackupController, 'callback')).toBeUndefined();
  });

  it('delegates the reads, the schedule and "send now"', async () => {
    const { c, runs } = setup();
    expect(c.overview()).toBe('overview');
    expect(c.list({ limit: 5 })).toBe('runs');
    expect(runs.runs).toHaveBeenCalledWith(5);
    await expect(c.schedule({ daily: true, hourUtc: 3 }, 'owner-1')).resolves.toEqual({ daily: true, hourUtc: 3 });
    expect(runs.setSchedule).toHaveBeenCalledWith({ daily: true, hourUtc: 3 }, 'owner-1');
    expect(c.runNow('owner-1')).toBe('sent');
  });

  it('sends the encrypted backup as a private file download', async () => {
    const { c, runs, res } = setup();
    const r = res();
    const file = await c.encrypted({ passphrase: 'a long passphrase' }, r as never, 'owner-1');
    expect(file).toBeInstanceOf(StreamableFile);
    expect(file.options.length).toBe(6);
    expect(runs.encryptedDownload).toHaveBeenCalledWith('a long passphrase', 'owner-1');
    expect(r.setHeader).toHaveBeenCalledWith('content-disposition', 'attachment; filename="patron-backup-x.patronbak"');
    expect(r.setHeader).toHaveBeenCalledWith('cache-control', 'no-store');
  });

  it('checks an uploaded file, and asks for one when missing', () => {
    const { c, runs } = setup();
    expect(c.verify({ buffer: Buffer.from('{}') }, { passphrase: 'p' })).toBe('checked');
    expect(runs.verify).toHaveBeenCalledWith(Buffer.from('{}'), 'p');
    expect(() => c.verify(undefined, {})).toThrow(BadRequestException);
    expect(() => c.verify({ buffer: Buffer.alloc(0) }, {})).toThrow('Choose a backup file');
  });

  it('hands out the consent link', async () => {
    const { c, drive } = setup();
    await expect(c.connect({ returnTo: 'https://admin.shop.test/settings' }, 'owner-1')).resolves.toEqual({
      url: 'https://accounts.google.com/o/oauth2/v2/auth?x',
    });
    expect(drive.consentUrl).toHaveBeenCalledWith('owner-1', 'https://admin.shop.test/settings');
  });

  describe('callback', () => {
    it('connects and sends the owner back to the dashboard', async () => {
      const { c, drive, audit, res } = setup();
      const r = res();
      await c.callback('code-1', 'state-1', undefined, r as never);
      expect(drive.verifyState).toHaveBeenCalledWith('state-1');
      expect(drive.connect).toHaveBeenCalledWith('code-1', 'owner-1');
      expect(audit.recordAsync).toHaveBeenCalledWith(expect.objectContaining({ action: 'backup.drive.connect', actorId: 'owner-1' }));
      expect(r.redirect).toHaveBeenCalledWith(302, 'https://admin.shop.test/settings?gdrive=connected#backup');
    });

    it('reports a refusal or a bad state without connecting', async () => {
      const { c, drive, res } = setup();
      const r1 = res();
      await c.callback(undefined, 'state-1', 'access_denied', r1 as never);
      expect(drive.connect).not.toHaveBeenCalled();
      expect(r1.redirect).toHaveBeenCalledWith(302, 'https://admin.shop.test/settings?gdrive=error&reason=access_denied#backup');

      drive.verifyState.mockRejectedValueOnce(new BadRequestException({ error: 'GDRIVE_STATE_INVALID', message: 'invalid' }));
      const r2 = res();
      await c.callback('code', 'forged', undefined, r2 as never);
      expect(drive.connect).not.toHaveBeenCalled();
      // no trusted page to return to: a small page says what happened
      expect(r2.status).toHaveBeenCalledWith(400);
      expect(r2.send).toHaveBeenCalledWith(expect.stringContaining('لم يتم ربط Google Drive'));
    });

    it('shows a page when there is no dashboard to return to', async () => {
      const { c, drive, res } = setup();
      drive.verifyState.mockResolvedValueOnce({ userId: 'owner-1', returnTo: null });
      drive.connect.mockResolvedValueOnce({ email: '<b>x</b>@gmail.test' });
      const r = res();
      await c.callback('code', 's', undefined, r as never);
      expect(r.status).toHaveBeenCalledWith(200);
      const html = (r.send.mock.calls[0] as unknown[])[0] as string;
      expect(html).toContain('تم ربط Google Drive');
      expect(html).toContain('&#60;b&#62;x&#60;/b&#62;@gmail.test');

      drive.verifyState.mockResolvedValueOnce({ userId: 'owner-1', returnTo: null });
      drive.connect.mockRejectedValueOnce(new Error('token exchange failed'));
      const r2 = res();
      await c.callback('code', 's', undefined, r2 as never);
      expect(r2.status).toHaveBeenCalledWith(400);
      expect(r2.send).toHaveBeenCalledWith(expect.stringContaining('token exchange failed'));

      drive.verifyState.mockResolvedValueOnce({ userId: 'owner-1', returnTo: null });
      drive.connect.mockResolvedValueOnce({ email: null });
      const r3 = res();
      await c.callback('code', 's', undefined, r3 as never);
      expect(r3.send).toHaveBeenCalledWith(expect.stringContaining('تم الربط.'));

      drive.verifyState.mockRejectedValueOnce('odd');
      const r4 = res();
      await c.callback('code', 's', 'server_error', r4 as never);
      expect(r4.send).toHaveBeenCalledWith(expect.stringContaining('خطأ غير متوقع'));
    });
  });

  it('disconnecting also switches the schedule off', async () => {
    const { c, drive, runs, audit } = setup();
    await expect(c.disconnect('owner-1')).resolves.toEqual({ connected: false });
    expect(drive.disconnect).toHaveBeenCalled();
    expect(runs.setSchedule).toHaveBeenCalledWith({ daily: false, weekly: false }, 'owner-1');
    expect(audit.recordAsync).toHaveBeenCalledWith(expect.objectContaining({ action: 'backup.drive.disconnect' }));

    runs.schedule.mockResolvedValueOnce({ daily: false, weekly: false });
    runs.setSchedule.mockClear();
    await c.disconnect('owner-1');
    expect(runs.setSchedule).not.toHaveBeenCalled();
  });
});
