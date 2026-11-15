import { createHash } from 'crypto';
import { CodesService } from '../../src/modules/auth/codes.service';
import { CaptureSmsSender, OwnerRelaySmsSender, SmsSender } from '../../src/modules/auth/senders/sms-sender';
import { CaptureEmailSender, DisabledEmailSender, EmailSender } from '../../src/modules/auth/senders/email-sender';
import { captureOutbox } from '../../src/modules/auth/senders/capture-outbox';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const PHONE = { kind: 'phone' as const, to: '+22222123456' };
const EMAIL = { kind: 'email' as const, to: 'a@b.c' };
const USER = { id: 'u1', locale: 'ar' };

describe('CodesService', () => {
  let prisma: any;
  let crypto: any;
  let config: any;

  const make = (sms: SmsSender = new CaptureSmsSender(), email: EmailSender = new CaptureEmailSender()) =>
    new CodesService(prisma, crypto, config, sms, email);

  const providerSms = (approve: (code: string) => boolean | Promise<boolean>): SmsSender => ({
    name: 'twilio_verify', relayedByStaff: false, providerChecksCode: true,
    send: jest.fn().mockResolvedValue(undefined),
    check: jest.fn(async (_to: string, code: string) => approve(code)),
  });

  beforeEach(() => {
    captureOutbox.clear();
    prisma = {
      verificationToken: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 't1', ...data })),
        update: jest.fn().mockResolvedValue({ attempts: 1 }),
      },
    };
    crypto = {
      sha256: sha,
      timingSafeEquals: (a: string, b: string) => a === b,
      randomNumericCode: () => '482913',
      randomToken: () => 'opaque',
      encrypt: (v: string) => `enc:${v}`,
    };
    config = { get: (k: string) => ({ 'security.resendCooldownSeconds': 60, 'security.maxCodeAttempts': 5 })[k] };
  });

  const live = (over: Record<string, unknown> = {}) => ({
    id: 't1', codeHash: sha('482913'), attempts: 0, expiresAt: new Date(Date.now() + 60_000), ...over,
  });

  describe('issue', () => {
    it('stores only the digest and sends the code (SMS provider)', async () => {
      expect(await make().issue(USER, 'PHONE_VERIFY', PHONE)).toBe('SENT');
      const data = prisma.verificationToken.create.mock.calls[0][0].data;
      expect(data.codeHash).toBe(sha('482913'));
      expect(data.codeEnc).toBeUndefined();
      expect(JSON.stringify(data)).not.toContain('482913');
      expect(captureOutbox.lastCode(PHONE.to)).toBe('482913');
      // older live codes for the same purpose stop working
      expect(prisma.verificationToken.updateMany.mock.calls[0][0].where).toEqual({ userId: 'u1', purpose: 'PHONE_VERIFY', consumedAt: null });
    });

    it('owner relay keeps an encrypted copy for the dashboard and reuses a live one', async () => {
      await make(new OwnerRelaySmsSender()).issue(USER, 'PHONE_LOGIN', PHONE);
      expect(prisma.verificationToken.create.mock.calls[0][0].data.codeEnc).toBe('enc:482913');

      prisma.verificationToken.findFirst.mockResolvedValue({ codeEnc: 'enc:111111' });
      expect(await make(new OwnerRelaySmsSender()).issue(USER, 'PHONE_LOGIN', PHONE)).toBe('REUSED');
      expect(prisma.verificationToken.create).toHaveBeenCalledTimes(1);
    });

    it('a private code (recovery) is never put where staff can read it', async () => {
      await expect(make(new OwnerRelaySmsSender()).issue(USER, 'ACCOUNT_RECOVERY', PHONE, { private: true })).rejects.toMatchObject({
        response: { error: 'PRIVATE_CHANNEL_UNAVAILABLE' },
      });
      expect(prisma.verificationToken.create).not.toHaveBeenCalled();
      expect(make(new OwnerRelaySmsSender()).canDeliverPrivately(PHONE)).toBe(false);
      expect(make(new OwnerRelaySmsSender()).canDeliverPrivately(EMAIL)).toBe(true);
      expect(make(undefined, new DisabledEmailSender()).canDeliverPrivately(EMAIL)).toBe(false);
    });

    it('with the provider making the code, stores a marker that no code can match', async () => {
      const sms = providerSms(() => true);
      await make(sms).issue(USER, 'PHONE_LOGIN', PHONE);
      expect(sms.send).toHaveBeenCalledWith(PHONE.to, null, 'PHONE_LOGIN');
      expect(prisma.verificationToken.create.mock.calls[0][0].data.codeHash).toBe('provider:opaque');
    });

    it('cooldown: 429 RESEND_COOLDOWN, or a quiet skip when the answer must not change', async () => {
      prisma.verificationToken.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 30_000) });
      await expect(make().issue(USER, 'EMAIL_VERIFY', EMAIL)).rejects.toMatchObject({ status: 429, response: { retryAfter: 30 } });
      expect(await make().issue(USER, 'EMAIL_VERIFY', EMAIL, { onCooldown: 'skip' })).toBe('COOLDOWN');
      expect(captureOutbox.email).toHaveLength(0);
    });

    it('email off: EMAIL_NOT_CONFIGURED before anything is stored', async () => {
      await expect(make(undefined, new DisabledEmailSender()).issue(USER, 'EMAIL_VERIFY', EMAIL)).rejects.toMatchObject({
        response: { error: 'EMAIL_NOT_CONFIGURED' },
      });
      expect(prisma.verificationToken.create).not.toHaveBeenCalled();
    });

    it('a code that could not be sent is burnt at once', async () => {
      const email: EmailSender = { name: 'resend', enabled: true, send: () => Promise.reject(new Error('down')) };
      await expect(make(undefined, email).issue(USER, 'EMAIL_VERIFY', EMAIL)).rejects.toMatchObject({
        response: { error: 'EMAIL_SEND_FAILED' },
      });
      expect(prisma.verificationToken.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { consumedAt: expect.any(Date) } });
    });
  });

  describe('consume', () => {
    it('accepts the right code once', async () => {
      prisma.verificationToken.findFirst.mockResolvedValue(live());
      await make().consume('u1', 'PHONE_VERIFY', '482913');
      expect(prisma.verificationToken.updateMany).toHaveBeenCalledWith({ where: { id: 't1', consumedAt: null }, data: { consumedAt: expect.any(Date) } });
    });

    it('a parallel use of the same code loses', async () => {
      prisma.verificationToken.findFirst.mockResolvedValue(live());
      prisma.verificationToken.updateMany.mockResolvedValue({ count: 0 });
      await expect(make().consume('u1', 'PHONE_VERIFY', '482913')).rejects.toMatchObject({ response: { error: 'INVALID_CODE' } });
    });

    it('rejects a wrong, a missing and an expired code alike', async () => {
      prisma.verificationToken.findFirst.mockResolvedValue(live());
      await expect(make().consume('u1', 'PHONE_VERIFY', '000000')).rejects.toThrow('Invalid or expired code');
      prisma.verificationToken.findFirst.mockResolvedValue(null);
      await expect(make().consume('u1', 'PHONE_VERIFY', '482913')).rejects.toThrow('Invalid or expired code');
      prisma.verificationToken.findFirst.mockResolvedValue(live({ expiresAt: new Date(Date.now() - 1) }));
      await expect(make().consume('u1', 'PHONE_VERIFY', '482913')).rejects.toThrow('Invalid or expired code');
    });

    it('counts every guess first and burns the code past the limit, even for the right one', async () => {
      prisma.verificationToken.findFirst.mockResolvedValue(live({ attempts: 5 }));
      prisma.verificationToken.update.mockResolvedValue({ attempts: 6 });
      await expect(make().consume('u1', 'PHONE_VERIFY', '482913')).rejects.toMatchObject({ response: { error: 'CODE_ATTEMPTS_EXCEEDED' } });
      expect(prisma.verificationToken.update.mock.calls[0][0].data).toEqual({ attempts: { increment: 1 } });
    });

    it('asks the provider when it made the code', async () => {
      const sms = providerSms((c) => c === '777777');
      prisma.verificationToken.findFirst.mockResolvedValue(live({ codeHash: 'provider:x' }));
      await make(sms).consume('u1', 'PHONE_LOGIN', '777777', PHONE);
      expect(sms.check).toHaveBeenCalledWith(PHONE.to, '777777');

      await expect(make(sms).consume('u1', 'PHONE_LOGIN', '111111', PHONE)).rejects.toMatchObject({ response: { error: 'INVALID_CODE' } });
      // without knowing where the code went, a provider code cannot be checked
      await expect(make(sms).consume('u1', 'PHONE_LOGIN', '777777')).rejects.toMatchObject({ response: { error: 'INVALID_CODE' } });
    });

    it('a provider outage is not a wrong code', async () => {
      const sms = providerSms(() => Promise.reject(new Error('503')));
      prisma.verificationToken.findFirst.mockResolvedValue(live({ codeHash: 'provider:x' }));
      await expect(make(sms).consume('u1', 'PHONE_LOGIN', '123456', PHONE)).rejects.toMatchObject({ response: { error: 'SMS_CHECK_FAILED' } });
    });
  });
});
