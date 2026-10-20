import nock from 'nock';
import { randomBytes, randomUUID } from 'crypto';
import { CryptoService } from '../../src/common/crypto/crypto.service';
import { GDRIVE_SCOPE, GDRIVE_SETTING, GoogleDriveService } from '../../src/modules/admin-tools/google-drive.service';

const GOOGLE_OAUTH = 'https://oauth2.googleapis.com';
const DRIVE = 'https://www.googleapis.com';

/** system_settings in memory, with the few filters the service uses. */
function fakeSettings() {
  const rows = new Map<string, unknown>();
  const matches = (key: string, where: { key?: string | { in: string[] }; value?: { equals: unknown } }) => {
    const k = where.key;
    const keyOk = typeof k === 'string' ? k === key : k ? k.in.includes(key) : true;
    return keyOk && (!where.value || rows.get(key) === where.value.equals);
  };
  const systemSetting = {
    findUnique: jest.fn(({ where }: { where: { key: string } }) =>
      Promise.resolve(rows.has(where.key) ? { key: where.key, value: rows.get(where.key) } : null)),
    upsert: jest.fn(({ where, update, create }: { where: { key: string }; update: { value: unknown }; create: { value: unknown } }) => {
      rows.set(where.key, rows.has(where.key) ? update.value : create.value);
      return Promise.resolve({});
    }),
    deleteMany: jest.fn(({ where }: { where: never }) => {
      let count = 0;
      for (const key of [...rows.keys()]) {
        if (matches(key, where)) {
          rows.delete(key);
          count++;
        }
      }
      return Promise.resolve({ count });
    }),
  };
  return { rows, prisma: { systemSetting } };
}

function setup(env: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    'crypto.encryptionKey': randomBytes(32).toString('hex'),
    'app.corsOrigins': 'https://admin.shop.test,https://store.shop.test',
    GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: `test-${randomUUID()}`,
    GOOGLE_REDIRECT_URI: 'https://api.shop.test/api/v1/admin/backup/gdrive/callback',
    ...env,
  };
  const config = {
    get: jest.fn((k: string) => values[k]),
    getOrThrow: jest.fn((k: string) => {
      if (!values[k]) throw new Error(`missing ${k}`);
      return values[k];
    }),
  };
  const crypto = new CryptoService(config as never);
  const { rows, prisma } = fakeSettings();
  const drive = new GoogleDriveService(prisma as never, crypto, config as never);
  return { drive, rows, crypto, values };
}

/** A connected Drive: an encrypted refresh token in the settings. */
function connected(s: ReturnType<typeof setup>, refresh = `rt-${randomUUID()}`) {
  s.rows.set(GDRIVE_SETTING.refreshToken, s.crypto.encrypt(refresh));
  return refresh;
}

const errCode = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'no error';
  } catch (e) {
    return ((e as { getResponse?: () => { error?: string } }).getResponse?.() ?? {}).error ?? (e as Error).message;
  }
};

describe('GoogleDriveService', () => {
  beforeAll(() => nock.disableNetConnect());
  afterEach(() => nock.cleanAll());
  afterAll(() => nock.enableNetConnect());

  it('names the missing settings and refuses to start without them', async () => {
    const s = setup({ GOOGLE_CLIENT_SECRET: undefined, GOOGLE_REDIRECT_URI: ' ' });
    expect(s.drive.missingEnv()).toEqual(['GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI']);
    expect(await errCode(s.drive.consentUrl('u1'))).toBe('GDRIVE_NOT_CONFIGURED');
    expect(await s.drive.status()).toEqual({
      configured: false, missing: ['GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'], connected: false, account: null,
    });
  });

  it('builds a consent link for drive.file with offline access and a signed state', async () => {
    const s = setup();
    const url = new URL(await s.drive.consentUrl('owner-1', 'https://admin.shop.test/settings'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')).toBe(GDRIVE_SCOPE);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('client_id')).toBe('client-id.apps.googleusercontent.com');
    expect(url.searchParams.get('redirect_uri')).toBe(s.values.GOOGLE_REDIRECT_URI);

    const state = url.searchParams.get('state')!;
    await expect(s.drive.verifyState(state)).resolves.toEqual({ userId: 'owner-1', returnTo: 'https://admin.shop.test/settings' });
    // once only
    expect(await errCode(s.drive.verifyState(state))).toBe('GDRIVE_STATE_INVALID');
  });

  it('refuses a forged, foreign, expired or superseded state', async () => {
    const s = setup();
    const state = new URL(await s.drive.consentUrl('owner-1')).searchParams.get('state')!;
    const [payload, sig] = state.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), u: 'attacker' })).toString('base64url');
    expect(await errCode(s.drive.verifyState(`${forged}.${sig}`))).toBe('GDRIVE_STATE_INVALID');
    expect(await errCode(s.drive.verifyState(undefined))).toBe('GDRIVE_STATE_INVALID');
    expect(await errCode(s.drive.verifyState('abc'))).toBe('GDRIVE_STATE_INVALID');
    // a state signed by another deployment's key
    const other = setup();
    const foreign = new URL(await other.drive.consentUrl('owner-1')).searchParams.get('state')!;
    expect(await errCode(s.drive.verifyState(foreign))).toBe('GDRIVE_STATE_INVALID');
    // a newer connect attempt replaces the older one
    const newer = new URL(await s.drive.consentUrl('owner-1')).searchParams.get('state')!;
    expect(await errCode(s.drive.verifyState(state))).toBe('GDRIVE_STATE_INVALID');
    // expired
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now + 11 * 60_000);
    expect(await errCode(s.drive.verifyState(newer))).toBe('GDRIVE_STATE_INVALID');
    spy.mockRestore();
  });

  it('only returns to a dashboard origin the API trusts', () => {
    const s = setup();
    expect(s.drive.safeReturnTo('https://admin.shop.test/settings?x=1#y')).toBe('https://admin.shop.test/settings');
    expect(s.drive.safeReturnTo('https://evil.test/settings')).toBeNull();
    expect(s.drive.safeReturnTo('javascript:alert(1)')).toBeNull();
    expect(s.drive.safeReturnTo('not a url')).toBeNull();
    expect(s.drive.safeReturnTo(undefined)).toBeNull();
    expect(setup({ 'app.corsOrigins': undefined }).drive.safeReturnTo('https://admin.shop.test/settings')).toBeNull();
  });

  it('exchanges the code and keeps the refresh token encrypted', async () => {
    const s = setup();
    const refresh = `rt-${randomUUID()}`;
    let form: URLSearchParams | null = null;
    nock(GOOGLE_OAUTH)
      .post('/token', (body) => {
        form = new URLSearchParams(body as unknown as string);
        return true;
      })
      .reply(200, { access_token: 'at-1', refresh_token: refresh, expires_in: 3599 });
    nock(DRIVE).get('/drive/v3/about').query({ fields: 'user(emailAddress)' }).matchHeader('authorization', 'Bearer at-1')
      .reply(200, { user: { emailAddress: 'owner@gmail.test' } });

    await expect(s.drive.connect('auth-code', 'owner-1')).resolves.toEqual({ email: 'owner@gmail.test' });
    expect(form!.get('grant_type')).toBe('authorization_code');
    expect(form!.get('code')).toBe('auth-code');
    expect(form!.get('redirect_uri')).toBe(s.values.GOOGLE_REDIRECT_URI);

    const stored = s.rows.get(GDRIVE_SETTING.refreshToken) as string;
    expect(stored).not.toContain(refresh);
    expect(s.crypto.decrypt(stored)).toBe(refresh);
    expect(s.rows.get(GDRIVE_SETTING.account)).toMatchObject({ email: 'owner@gmail.test', connectedById: 'owner-1' });
    expect(await s.drive.status()).toMatchObject({ configured: true, connected: true, account: { email: 'owner@gmail.test' } });
    expect(nock.isDone()).toBe(true);
  });

  it('connects even when the account name cannot be read, and fails without offline access', async () => {
    const s = setup();
    nock(GOOGLE_OAUTH).post('/token').reply(200, { access_token: 'at-1', refresh_token: 'rt', expires_in: 3600 });
    nock(DRIVE).get('/drive/v3/about').query(true).reply(500, {});
    await expect(s.drive.connect('c', 'u')).resolves.toEqual({ email: null });

    nock(GOOGLE_OAUTH).post('/token').reply(200, { access_token: 'at-2' });
    expect(await errCode(s.drive.connect('c', 'u'))).toBe('GDRIVE_ERROR');
    nock(GOOGLE_OAUTH).post('/token').reply(400, { error: 'invalid_grant', error_description: 'Bad Request' });
    await expect(s.drive.connect('c', 'u')).rejects.toThrow('Google Drive: connecting failed (invalid_grant: Bad Request)');
  });

  it('needs a connection before uploading', async () => {
    const s = setup();
    expect(await errCode(s.drive.upload('x', Buffer.from('x'), 'manual'))).toBe('GDRIVE_NOT_CONNECTED');
  });

  it('uploads into its own folder (created on first use) as one multipart request', async () => {
    const s = setup();
    const refresh = connected(s);
    nock(GOOGLE_OAUTH)
      .post('/token', (body) => new URLSearchParams(body as unknown as string).get('refresh_token') === refresh)
      .once()
      .reply(200, { access_token: 'at-9', expires_in: 3600 });
    nock(DRIVE)
      .get('/drive/v3/files')
      .query((q) => String(q.q).includes("name='Patron backups'") && String(q.q).includes("appProperties has { key='patronBackup' and value='folder' }"))
      .reply(200, { files: [] });
    nock(DRIVE)
      .post('/drive/v3/files', { name: 'Patron backups', mimeType: 'application/vnd.google-apps.folder', appProperties: { patronBackup: 'folder' } })
      .query({ fields: 'id' })
      .reply(200, { id: 'folder-1' });
    let sent = '';
    let type = '';
    nock(DRIVE)
      .post('/upload/drive/v3/files', (body) => {
        sent = typeof body === 'string' ? body : Buffer.from(body as never).toString('latin1');
        return true;
      })
      .query((q) => q.uploadType === 'multipart')
      .matchHeader('authorization', 'Bearer at-9')
      .matchHeader('content-type', (v) => {
        type = v;
        return v.startsWith('multipart/related; boundary=');
      })
      .reply(200, { id: 'file-1', name: 'b.patronbak', size: '5' });

    const out = await s.drive.upload('b.patronbak', Buffer.from('BYTES'), 'daily');

    expect(out).toEqual({ id: 'file-1', name: 'b.patronbak', size: '5' });
    expect(type).toContain('boundary=patron-');
    expect(sent).toContain('"parents":["folder-1"]');
    expect(sent).toContain('"appProperties":{"patronBackup":"daily"}');
    expect(sent).toContain('BYTES');
    expect(s.rows.get(GDRIVE_SETTING.folderId)).toBe('folder-1');
    expect(nock.isDone()).toBe(true);
  });

  it('reuses its folder, finds it again when it was trashed, and sends big files resumable', async () => {
    const s = setup();
    connected(s);
    s.rows.set(GDRIVE_SETTING.folderId, 'folder-old');
    nock(GOOGLE_OAUTH).post('/token').reply(200, { access_token: 'at', expires_in: 3600 });
    nock(DRIVE).get('/drive/v3/files/folder-old').query(true).reply(200, { id: 'folder-old', trashed: true });
    nock(DRIVE).get('/drive/v3/files').query(true).reply(200, { files: [{ id: 'folder-2', name: 'Patron backups' }] });
    const big = Buffer.alloc(5 * 1024 * 1024 + 1, 1);
    nock(DRIVE)
      .post('/upload/drive/v3/files')
      .query((q) => q.uploadType === 'resumable')
      .matchHeader('x-upload-content-length', String(big.length))
      .reply(200, {}, { location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=session-1' });
    let size = 0;
    nock(DRIVE)
      .put('/upload/drive/v3/files', (body) => {
        size = typeof body === 'string' ? body.length : -1;
        return true;
      })
      .query({ upload_id: 'session-1' })
      .reply(200, { id: 'file-big' });

    await expect(s.drive.upload('big.patronbak', big, 'weekly')).resolves.toEqual({ id: 'file-big' });
    expect(size).toBe(big.length);
    expect(s.rows.get(GDRIVE_SETTING.folderId)).toBe('folder-2');

    // the folder is fine now: no search, no new folder
    nock(DRIVE).get('/drive/v3/files/folder-2').query(true).reply(200, { id: 'folder-2', trashed: false });
    await expect(s.drive.folderId()).resolves.toBe('folder-2');
    expect(nock.isDone()).toBe(true);
  });

  it('says what Drive answered when an upload fails', async () => {
    const s = setup();
    connected(s);
    s.rows.set(GDRIVE_SETTING.folderId, 'f');
    nock(GOOGLE_OAUTH).post('/token').reply(200, { access_token: 'at', expires_in: 3600 });
    nock(DRIVE).get('/drive/v3/files/f').query(true).reply(200, { id: 'f' });
    nock(DRIVE).post('/upload/drive/v3/files').query(true).reply(403, { error: { message: 'The user has exceeded their Drive storage quota' } });
    await expect(s.drive.upload('x', Buffer.from('x'), 'manual')).rejects.toThrow('Google Drive: uploading failed (The user has exceeded their Drive storage quota)');

    nock(DRIVE).post('/upload/drive/v3/files').query(true).reply(500);
    nock(DRIVE).get('/drive/v3/files/f').query(true).reply(200, { id: 'f' });
    await expect(s.drive.upload('x', Buffer.from('x'), 'manual')).rejects.toThrow('(HTTP 500)');
  });

  it('a connection saved under another ENCRYPTION_KEY asks to reconnect', async () => {
    const s = setup();
    s.rows.set(GDRIVE_SETTING.refreshToken, 'not.a.ciphertext');
    expect(await errCode(s.drive.folderId())).toBe('GDRIVE_RECONNECT');
  });

  it('a revoked connection fails clearly', async () => {
    const s = setup();
    connected(s);
    nock(GOOGLE_OAUTH).post('/token').reply(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
    await expect(s.drive.folderId()).rejects.toThrow('signing in failed (invalid_grant: Token has been expired or revoked.)');
  });

  it('trims only its own older copies of the same kind, into the trash', async () => {
    const s = setup();
    connected(s);
    s.rows.set(GDRIVE_SETTING.folderId, 'f');
    nock(GOOGLE_OAUTH).post('/token').reply(200, { access_token: 'at', expires_in: 3600 });
    nock(DRIVE).get('/drive/v3/files/f').query(true).reply(200, { id: 'f' });
    let q = '';
    nock(DRIVE)
      .get('/drive/v3/files')
      .query((query) => {
        q = String(query.q);
        return query.orderBy === 'createdTime desc';
      })
      .reply(200, { files: [{ id: 'n1' }, { id: 'n2' }, { id: 'o1' }, { id: 'o2' }] });
    nock(DRIVE).patch('/drive/v3/files/o1', { trashed: true }).reply(200, {});
    nock(DRIVE).patch('/drive/v3/files/o2', { trashed: true }).reply(200, {});

    await expect(s.drive.prune('daily', 2)).resolves.toEqual(['o1', 'o2']);
    expect(q).toContain("'f' in parents");
    expect(q).toContain("appProperties has { key='patronBackup' and value='daily' }");
    expect(nock.isDone()).toBe(true);
  });

  it('keeps at least the newest copy whatever keep says', async () => {
    const s = setup();
    connected(s);
    s.rows.set(GDRIVE_SETTING.folderId, 'f');
    nock(GOOGLE_OAUTH).post('/token').reply(200, { access_token: 'at', expires_in: 3600 });
    nock(DRIVE).get('/drive/v3/files/f').query(true).reply(200, { id: 'f' });
    nock(DRIVE).get('/drive/v3/files').query(true).reply(200, { files: [{ id: 'n1' }, { id: 'o1' }] });
    nock(DRIVE).patch('/drive/v3/files/o1').reply(200, {});
    await expect(s.drive.prune('weekly', 0)).resolves.toEqual(['o1']);
  });

  it('disconnects: revokes at Google and forgets everything', async () => {
    const s = setup();
    const refresh = connected(s);
    s.rows.set(GDRIVE_SETTING.account, { email: 'a' });
    s.rows.set(GDRIVE_SETTING.folderId, 'f');
    s.rows.set('backup.schedule', { daily: true });
    let revoked = '';
    nock(GOOGLE_OAUTH)
      .post('/revoke', (body) => {
        revoked = new URLSearchParams(body as unknown as string).get('token') ?? '';
        return true;
      })
      .reply(200, {});
    await s.drive.disconnect();
    expect(revoked).toBe(refresh);
    expect([...s.rows.keys()]).toEqual(['backup.schedule']);

    // nothing to revoke, and a failed revoke, still disconnect
    await s.drive.disconnect();
    connected(s);
    nock(GOOGLE_OAUTH).post('/revoke').replyWithError('offline');
    await s.drive.disconnect();
    expect(s.rows.has(GDRIVE_SETTING.refreshToken)).toBe(false);
  });
});
