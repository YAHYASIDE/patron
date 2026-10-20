import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';

/**
 * The owner's Google Drive as a backup destination.
 *
 * The owner connects once with Google's consent screen (OAuth 2.0, scope
 * `drive.file`: the app sees only the files it created itself, never the rest
 * of the Drive). Google hands back a refresh token, stored encrypted with the
 * shop's ENCRYPTION_KEY under `backup.gdrive.*` settings, which the backup
 * itself never carries. Uploads go into a "Patron backups" folder through the
 * Drive REST API (v3) with plain fetch; every file is tagged with a private
 * appProperty so retention only ever touches copies this app made.
 */
export const GDRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_FOLDER_NAME = 'Patron backups';
export const GDRIVE_SETTING = {
  refreshToken: 'backup.gdrive.refresh_token',
  account: 'backup.gdrive.account',
  folderId: 'backup.gdrive.folder_id',
  oauthNonce: 'backup.gdrive.oauth_nonce',
} as const;

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
/** Private tag on everything this app creates in the Drive. */
const APP_TAG = 'patronBackup';
/** Google's limit for a one-request (multipart) upload; larger files go resumable. */
const MULTIPART_MAX_BYTES = 5 * 1024 * 1024;
const STATE_TTL_MS = 10 * 60_000;

export type DriveFileKind = 'daily' | 'weekly' | 'manual';

export interface DriveFile {
  id: string;
  name: string;
  size?: string;
  createdTime?: string;
}

export interface DriveStatus {
  configured: boolean;
  /** Names of the environment variables still to set (never their values). */
  missing: string[];
  connected: boolean;
  account: { email: string | null; connectedAt: string } | null;
}

type Json = Record<string, unknown>;

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** A Drive or OAuth failure, in words the owner can act on (never with a token in it). */
function driveError(what: string, status: number, body: unknown): BadRequestException {
  const b = (body ?? {}) as { error?: unknown; error_description?: unknown };
  const detail =
    typeof b.error === 'string'
      ? `${b.error}${typeof b.error_description === 'string' ? `: ${b.error_description}` : ''}`
      : typeof (b.error as Json | undefined)?.message === 'string'
        ? String((b.error as Json).message)
        : `HTTP ${status}`;
  return new BadRequestException({ error: 'GDRIVE_ERROR', message: `Google Drive: ${what} failed (${detail})` });
}

@Injectable()
export class GoogleDriveService {
  private readonly log = new Logger(GoogleDriveService.name);
  private cached: { token: string; until: number } | null = null;

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private config: ConfigService,
  ) {}

  private env() {
    const get = (k: string) => this.config.get<string>(k)?.trim() || '';
    return {
      clientId: get('GOOGLE_CLIENT_ID'),
      clientSecret: get('GOOGLE_CLIENT_SECRET'),
      redirectUri: get('GOOGLE_REDIRECT_URI'),
    };
  }

  missingEnv(): string[] {
    const e = this.env();
    return [
      ...(e.clientId ? [] : ['GOOGLE_CLIENT_ID']),
      ...(e.clientSecret ? [] : ['GOOGLE_CLIENT_SECRET']),
      ...(e.redirectUri ? [] : ['GOOGLE_REDIRECT_URI']),
    ];
  }

  assertConfigured() {
    const missing = this.missingEnv();
    if (missing.length) {
      throw new BadRequestException({
        error: 'GDRIVE_NOT_CONFIGURED',
        message: `Google Drive is not set up on the server: ${missing.join(', ')} missing`,
        missing,
      });
    }
  }

  private async setting<T>(key: string): Promise<T | null> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    return (row?.value ?? null) as T | null;
  }

  private async put(key: string, value: string | Json, description: string) {
    await this.prisma.systemSetting.upsert({
      where: { key },
      update: { value: value as never },
      create: { key, value: value as never, group: 'backup', description },
    });
  }

  async status(): Promise<DriveStatus> {
    const missing = this.missingEnv();
    const [token, account] = await Promise.all([
      this.setting<string>(GDRIVE_SETTING.refreshToken),
      this.setting<{ email: string | null; connectedAt: string }>(GDRIVE_SETTING.account),
    ]);
    return { configured: missing.length === 0, missing, connected: !!token, account: token ? account : null };
  }

  // ─── OAuth ───

  /** HMAC key for the OAuth state, derived from ENCRYPTION_KEY (never the key itself). */
  private stateKey() {
    return createHmac('sha256', Buffer.from(this.config.getOrThrow<string>('crypto.encryptionKey'), 'hex'))
      .update('patron-gdrive-oauth-state')
      .digest();
  }

  /** Only a dashboard origin the API already trusts (CORS_ORIGINS) may be returned to. */
  safeReturnTo(returnTo?: string | null): string | null {
    if (!returnTo) return null;
    let url: URL;
    try {
      url = new URL(returnTo);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const allowed = (this.config.get<string>('app.corsOrigins') ?? '')
      .split(',')
      .map((o) => o.trim().replace(/\/$/, ''))
      .filter(Boolean);
    return allowed.includes(url.origin) ? `${url.origin}${url.pathname}` : null;
  }

  /** Google's consent page for this owner; the state is signed, expires in 10 minutes and works once. */
  async consentUrl(userId: string, returnTo?: string): Promise<string> {
    this.assertConfigured();
    const nonce = randomBytes(16).toString('base64url');
    const payload = b64url(JSON.stringify({ u: userId, n: nonce, e: Date.now() + STATE_TTL_MS, r: this.safeReturnTo(returnTo) }));
    const state = `${payload}.${b64url(createHmac('sha256', this.stateKey()).update(payload).digest())}`;
    await this.put(GDRIVE_SETTING.oauthNonce, sha(nonce), 'The pending Google Drive connection (one use)');
    const { clientId, redirectUri } = this.env();
    const q = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GDRIVE_SCOPE,
      access_type: 'offline',
      // always ask: Google returns a refresh token only on a fresh consent
      prompt: 'consent',
      include_granted_scopes: 'false',
      state,
    });
    return `${AUTH_URL}?${q.toString()}`;
  }

  /** The state Google sent back: signed by us, not expired, and the latest connect attempt. */
  async verifyState(state: string | undefined): Promise<{ userId: string; returnTo: string | null }> {
    const bad = () => new BadRequestException({ error: 'GDRIVE_STATE_INVALID', message: 'This Google Drive link is invalid or expired: start again from the dashboard' });
    const [payload, sig] = (state ?? '').split('.');
    if (!payload || !sig) throw bad();
    const expected = createHmac('sha256', this.stateKey()).update(payload).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw bad();
    let data: { u?: string; n?: string; e?: number; r?: string | null };
    try {
      data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      throw bad();
    }
    if (!data.u || !data.n || !data.e || data.e < Date.now()) throw bad();
    // one use: the stored nonce is consumed whatever happens next
    const consumed = await this.prisma.systemSetting.deleteMany({ where: { key: GDRIVE_SETTING.oauthNonce, value: { equals: sha(data.n) } } });
    if (consumed.count !== 1) throw bad();
    return { userId: data.u, returnTo: this.safeReturnTo(data.r) };
  }

  private async tokenRequest(form: Record<string, string>, what: string) {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
    const body = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok) throw driveError(what, res.status, body);
    return body;
  }

  /** Exchange the consent code for tokens and keep the refresh token, encrypted. */
  async connect(code: string, userId: string) {
    this.assertConfigured();
    const { clientId, clientSecret, redirectUri } = this.env();
    const tokens = await this.tokenRequest(
      { grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri },
      'connecting',
    );
    const refresh = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : '';
    const access = typeof tokens.access_token === 'string' ? tokens.access_token : '';
    if (!refresh || !access) {
      throw new BadRequestException({ error: 'GDRIVE_ERROR', message: 'Google did not grant offline access: connect again and accept every step' });
    }
    this.cached = { token: access, until: Date.now() + (Number(tokens.expires_in) || 3600) * 1000 - 60_000 };
    let email: string | null = null;
    try {
      const about = await this.call<{ user?: { emailAddress?: string } }>('GET', `${DRIVE}/about?fields=user(emailAddress)`, 'reading the account');
      email = about.user?.emailAddress ?? null;
    } catch {
      /* the name of the account is nice to show, not needed */
    }
    await this.put(GDRIVE_SETTING.refreshToken, this.crypto.encrypt(refresh), 'Google Drive refresh token (encrypted)');
    await this.put(GDRIVE_SETTING.account, { email, connectedAt: new Date().toISOString(), connectedById: userId }, 'The Google account backups go to');
    await this.prisma.systemSetting.deleteMany({ where: { key: GDRIVE_SETTING.folderId } });
    return { email };
  }

  /** Forget the connection here and ask Google to revoke it (best effort). */
  async disconnect() {
    const enc = await this.setting<string>(GDRIVE_SETTING.refreshToken);
    if (enc) {
      try {
        const token = this.crypto.decrypt(enc);
        await fetch(REVOKE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token }).toString(),
        });
      } catch (e) {
        this.log.warn(`Google Drive revoke failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    this.cached = null;
    await this.prisma.systemSetting.deleteMany({
      where: { key: { in: [GDRIVE_SETTING.refreshToken, GDRIVE_SETTING.account, GDRIVE_SETTING.folderId, GDRIVE_SETTING.oauthNonce] } },
    });
  }

  private async accessToken(): Promise<string> {
    if (this.cached && this.cached.until > Date.now()) return this.cached.token;
    this.assertConfigured();
    const enc = await this.setting<string>(GDRIVE_SETTING.refreshToken);
    if (!enc) throw new BadRequestException({ error: 'GDRIVE_NOT_CONNECTED', message: 'Google Drive is not connected' });
    let refresh: string;
    try {
      refresh = this.crypto.decrypt(enc);
    } catch {
      // saved under another ENCRYPTION_KEY (or damaged): only a new consent fixes it
      throw new BadRequestException({
        error: 'GDRIVE_RECONNECT',
        message: 'The saved Google Drive connection cannot be read (was ENCRYPTION_KEY changed?): disconnect and connect again',
      });
    }
    const { clientId, clientSecret } = this.env();
    const tokens = await this.tokenRequest(
      { grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId, client_secret: clientSecret },
      'signing in',
    );
    const token = String(tokens.access_token ?? '');
    this.cached = { token, until: Date.now() + (Number(tokens.expires_in) || 3600) * 1000 - 60_000 };
    return token;
  }

  private async call<T>(method: string, url: string, what: string, body?: Json): Promise<T> {
    const res = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${await this.accessToken()}`, ...(body && { 'content-type': 'application/json; charset=UTF-8' }) },
      ...(body && { body: JSON.stringify(body) }),
    });
    const data = (await res.json().catch(() => ({}))) as T;
    if (!res.ok) throw driveError(what, res.status, data);
    return data;
  }

  /** The "Patron backups" folder this app made, created on first use. */
  async folderId(): Promise<string> {
    const known = await this.setting<string>(GDRIVE_SETTING.folderId);
    if (known) {
      const res = await fetch(`${DRIVE}/files/${encodeURIComponent(known)}?fields=id,trashed`, {
        headers: { authorization: `Bearer ${await this.accessToken()}` },
      });
      const f = (await res.json().catch(() => ({}))) as { id?: string; trashed?: boolean };
      if (res.ok && f.id && !f.trashed) return known;
    }
    const q = `mimeType='${FOLDER_MIME}' and name='${DRIVE_FOLDER_NAME}' and trashed=false and appProperties has { key='${APP_TAG}' and value='folder' }`;
    const found = await this.call<{ files?: DriveFile[] }>('GET', `${DRIVE}/files?${new URLSearchParams({ q, fields: 'files(id,name)', spaces: 'drive' })}`, 'finding the folder');
    const id =
      found.files?.[0]?.id ??
      (await this.call<{ id: string }>('POST', `${DRIVE}/files?fields=id`, 'creating the folder', {
        name: DRIVE_FOLDER_NAME, mimeType: FOLDER_MIME, appProperties: { [APP_TAG]: 'folder' },
      })).id;
    await this.put(GDRIVE_SETTING.folderId, id, 'The Drive folder backups go to');
    return id;
  }

  /** Upload one backup file into the folder, tagged with its kind for retention. */
  async upload(name: string, data: Buffer, kind: DriveFileKind): Promise<DriveFile> {
    const parent = await this.folderId();
    const metadata = { name, parents: [parent], mimeType: 'application/octet-stream', appProperties: { [APP_TAG]: kind } };
    const token = await this.accessToken();
    const fields = 'id,name,size,createdTime';

    if (data.length <= MULTIPART_MAX_BYTES) {
      const boundary = `patron-${randomBytes(12).toString('hex')}`;
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\ncontent-type: application/octet-stream\r\n\r\n`),
        data,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const res = await fetch(`${UPLOAD}/files?uploadType=multipart&fields=${fields}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/related; boundary=${boundary}` },
        body,
      });
      const out = (await res.json().catch(() => ({}))) as DriveFile;
      if (!res.ok) throw driveError('uploading', res.status, out);
      return out;
    }

    // a large shop: one resumable session, sent in a single PUT
    const start = await fetch(`${UPLOAD}/files?uploadType=resumable&fields=${fields}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-type': 'application/octet-stream',
        'x-upload-content-length': String(data.length),
      },
      body: JSON.stringify(metadata),
    });
    const session = start.headers.get('location');
    if (!start.ok || !session) throw driveError('starting the upload', start.status, await start.json().catch(() => ({})));
    const res = await fetch(session, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(data) });
    const out = (await res.json().catch(() => ({}))) as DriveFile;
    if (!res.ok) throw driveError('uploading', res.status, out);
    return out;
  }

  /**
   * Keep the newest `keep` copies of one kind; older ones go to the Drive's
   * trash (recoverable there for 30 days). Only files this app created and
   * tagged are ever listed, so nothing else in the Drive can be touched.
   */
  async prune(kind: DriveFileKind, keep: number): Promise<string[]> {
    const parent = await this.folderId();
    const q = `'${parent}' in parents and trashed=false and appProperties has { key='${APP_TAG}' and value='${kind}' }`;
    const list = await this.call<{ files?: DriveFile[] }>(
      'GET',
      `${DRIVE}/files?${new URLSearchParams({ q, orderBy: 'createdTime desc', pageSize: '200', fields: 'files(id,name,createdTime)', spaces: 'drive' })}`,
      'listing old copies',
    );
    const old = (list.files ?? []).slice(Math.max(1, keep));
    for (const f of old) await this.call('PATCH', `${DRIVE}/files/${encodeURIComponent(f.id)}`, 'removing an old copy', { trashed: true });
    return old.map((f) => f.id);
  }
}
