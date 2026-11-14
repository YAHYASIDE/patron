import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { RecoveryService } from '../../src/modules/auth/recovery.service';
import { CodesService } from '../../src/modules/auth/codes.service';
import { LoginGuardService } from '../../src/modules/auth/login-guard.service';
import { CaptureSmsSender, OwnerRelaySmsSender, SmsSender } from '../../src/modules/auth/senders/sms-sender';
import { CaptureEmailSender, DisabledEmailSender, EmailSender } from '../../src/modules/auth/senders/email-sender';
import { captureOutbox } from '../../src/modules/auth/senders/capture-outbox';

// a fresh password per run: nothing that reads like a credential lives in the repo
const NEW_PASSWORD = `N3w${randomUUID()}`;

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const META = { ip: '5.6.7.8', userAgent: 'jest' };
const OLD = '+22222123456';
const NEW = '+22233123456';

describe('RecoveryService', () => {
  let prisma: any;
  let crypto: any;
  let tokens: any;
  let staff: any;
  let config: any;

  const make = (sms: SmsSender = new CaptureSmsSender(), email: EmailSender = new CaptureEmailSender()) =>
    new RecoveryService(prisma, crypto, new CodesService(prisma, crypto, config, sms, email), new LoginGuardService(prisma, config), tokens, staff);

  const request = (over: Record<string, unknown> = {}) => ({
    id: 'rq1', userId: 'u1', contact: OLD, fullName: 'Sidi', proof: 'Last order 500 MRU', newContact: NEW,
    status: 'PENDING', ...over,
  });

  beforeEach(() => {
    captureOutbox.clear();
    prisma = {
      user: {
        // the "is the new contact someone else's?" lookup finds nobody by default
        findFirst: jest.fn().mockImplementation(({ where }) =>
          Promise.resolve(where.id?.not ? null : { id: 'u1', locale: 'ar', phone: OLD, deletedAt: null })),
        update: jest.fn().mockReturnValue('user-update'),
      },
      accountRecoveryRequest: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'rq1', ...data })),
        findUnique: jest.fn().mockResolvedValue(request()),
        findFirst: jest.fn().mockResolvedValue(request({ status: 'VERIFIED' })),
        findMany: jest.fn().mockResolvedValue([request()]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockReturnValue('request-update'),
      },
      verificationToken: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 't1', ...data })),
        update: jest.fn().mockResolvedValue({ attempts: 1 }),
      },
      loginAttempt: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    crypto = {
      sha256: sha, timingSafeEquals: (a: string, b: string) => a === b, randomNumericCode: () => '246810',
      randomToken: () => 'x', encrypt: (v: string) => `enc:${v}`, hashPassword: jest.fn().mockResolvedValue('$argon2id$new'),
    };
    tokens = { revokeAllForUser: jest.fn() };
    staff = { notify: jest.fn(), resolve: jest.fn() };
    config = { get: () => undefined };
  });

  describe('the customer asks for help', () => {
    const dto = { contact: OLD, fullName: ' Sidi ', proof: 'Last order 500 MRU PUBG', newContact: NEW };

    it('records it, tells the owner and audits — the same answer whether or not an account matches', async () => {
      const found = await make().request(dto, META);
      prisma.user.findFirst.mockResolvedValue(null);
      const missing = await make().request({ ...dto, contact: '+22299999999' }, META);

      expect(found).toEqual(missing);
      expect(prisma.accountRecoveryRequest.create.mock.calls[0][0].data).toMatchObject({ userId: 'u1', contact: OLD, newContact: NEW, fullName: 'Sidi', ipAddress: META.ip });
      expect(prisma.accountRecoveryRequest.create.mock.calls[1][0].data.userId).toBeNull();
      expect(staff.notify.mock.calls[0][0]).toMatchObject({ type: 'recovery.new', link: '/recovery?id=rq1', dedupeKey: 'recovery.new:rq1' });
      expect(staff.notify.mock.calls[0][0].body).not.toContain(OLD); // masked
      expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe('recovery.requested');
    });

    it('stops storing after a few open requests for one contact, still with the same answer', async () => {
      prisma.accountRecoveryRequest.count.mockResolvedValue(3);
      const res = await make().request(dto, META);
      expect(res.message).toMatch(/Request received/);
      expect(prisma.accountRecoveryRequest.create).not.toHaveBeenCalled();
      expect(staff.notify).not.toHaveBeenCalled();
    });

    it('ignores a "new" contact that is the same as the old one', async () => {
      await make().request({ ...dto, newContact: OLD }, META);
      expect(prisma.accountRecoveryRequest.create.mock.calls[0][0].data.newContact).toBeNull();
    });
  });

  describe('staff review', () => {
    it('verify: the system sends the code to the new contact; staff get only a masked address', async () => {
      const res = await make().verify('rq1', 'staff-1', 'matched 2 orders', META);

      expect(res).toEqual({ status: 'VERIFIED', sentTo: '+222****3456', channel: 'phone' });
      expect(JSON.stringify(res)).not.toContain('246810');
      expect(captureOutbox.lastCode(NEW)).toBe('246810');
      const token = prisma.verificationToken.create.mock.calls[0][0].data;
      expect(token).toMatchObject({ purpose: 'ACCOUNT_RECOVERY', codeHash: sha('246810') });
      expect(token.codeEnc).toBeUndefined(); // nothing readable for the relay page

      const audit = prisma.auditLog.create.mock.calls[0][0].data;
      expect(audit).toMatchObject({ userId: 'staff-1', action: 'recovery.verified', entityId: 'rq1' });
      expect(JSON.stringify(audit)).not.toContain('246810');
      expect(staff.resolve).toHaveBeenCalledWith('recovery.new:rq1');
    });

    it('never falls back to the owner-relay page: the code would be in front of staff', async () => {
      await expect(make(new OwnerRelaySmsSender()).verify('rq1', 'staff-1', undefined, META)).rejects.toMatchObject({
        response: { error: 'RECOVERY_CHANNEL_UNAVAILABLE', channel: 'phone' },
      });
      expect(prisma.verificationToken.create).not.toHaveBeenCalled();
      expect(prisma.accountRecoveryRequest.updateMany).not.toHaveBeenCalled();
    });

    it('an email destination needs email to be on', async () => {
      prisma.accountRecoveryRequest.findUnique.mockResolvedValue(request({ newContact: 'me@new.mr' }));
      prisma.user.findFirst.mockResolvedValueOnce({ id: 'u1' }).mockResolvedValueOnce(null);
      await expect(make(undefined, new DisabledEmailSender()).verify('rq1', 's', undefined, META)).rejects.toMatchObject({
        response: { error: 'RECOVERY_CHANNEL_UNAVAILABLE', channel: 'email' },
      });
    });

    it('puts the request back to pending when the code cannot be sent', async () => {
      const failing: SmsSender = { name: 'twilio_verify', relayedByStaff: false, providerChecksCode: true, send: () => Promise.reject(new Error('x')), check: () => Promise.resolve(false) };
      await expect(make(failing).verify('rq1', 'staff-1', undefined, META)).rejects.toMatchObject({ response: { error: 'SMS_SEND_FAILED' } });
      expect(prisma.accountRecoveryRequest.update).toHaveBeenCalledWith({
        where: { id: 'rq1' }, data: { status: 'PENDING', reviewedById: null, reviewNote: null, reviewedAt: null },
      });
    });

    it('refuses a request with no matching account, a closed one, and a new contact owned by someone else', async () => {
      prisma.accountRecoveryRequest.findUnique.mockResolvedValueOnce(request({ userId: null }));
      await expect(make().verify('rq1', 's', undefined, META)).rejects.toMatchObject({ response: { error: 'RECOVERY_NO_ACCOUNT' } });

      prisma.accountRecoveryRequest.findUnique.mockResolvedValueOnce(request({ status: 'REJECTED' }));
      await expect(make().verify('rq1', 's', undefined, META)).rejects.toMatchObject({ response: { error: 'RECOVERY_CLOSED' } });

      prisma.user.findFirst.mockResolvedValueOnce({ id: 'u1' }).mockResolvedValueOnce({ id: 'someone-else' });
      await expect(make().verify('rq1', 's', undefined, META)).rejects.toMatchObject({ response: { error: 'RECOVERY_CONTACT_TAKEN' } });

      prisma.accountRecoveryRequest.findUnique.mockResolvedValueOnce(null);
      await expect(make().verify('nope', 's', undefined, META)).rejects.toMatchObject({ response: { error: 'RECOVERY_NOT_FOUND' } });
    });

    it('two staff verifying at once send one code', async () => {
      prisma.accountRecoveryRequest.updateMany.mockResolvedValue({ count: 0 });
      await expect(make().verify('rq1', 's', undefined, META)).rejects.toMatchObject({ response: { error: 'RECOVERY_CLOSED' } });
      expect(prisma.verificationToken.create).not.toHaveBeenCalled();
    });

    it('verifying again re-sends (audited as a resend)', async () => {
      prisma.accountRecoveryRequest.findUnique.mockResolvedValue(request({ status: 'VERIFIED' }));
      await make().verify('rq1', 's', undefined, META);
      expect(prisma.accountRecoveryRequest.updateMany).not.toHaveBeenCalled();
      expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe('recovery.code_resent');
    });

    it('reject closes it and burns any code already sent', async () => {
      await make().reject('rq1', 'staff-1', 'proof did not match', META);
      expect(prisma.verificationToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', purpose: 'ACCOUNT_RECOVERY', consumedAt: null }, data: { consumedAt: expect.any(Date) },
      });
      expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe('recovery.rejected');

      prisma.accountRecoveryRequest.updateMany.mockResolvedValue({ count: 0 });
      await expect(make().reject('rq1', 's', undefined, META)).rejects.toMatchObject({ response: { error: 'RECOVERY_CLOSED' } });
      prisma.accountRecoveryRequest.findUnique.mockResolvedValue(null);
      await expect(make().reject('rq1', 's', undefined, META)).rejects.toMatchObject({ response: { error: 'RECOVERY_NOT_FOUND' } });
    });

    it('lists open requests with the account\'s recent orders and whether a code can be sent', async () => {
      const rows = await make(new OwnerRelaySmsSender()).list();
      expect(prisma.accountRecoveryRequest.findMany.mock.calls[0][0].where).toEqual({ status: { in: ['PENDING', 'VERIFIED'] } });
      expect(prisma.accountRecoveryRequest.findMany.mock.calls[0][0].include.user.select.orders.take).toBe(5);
      expect(rows[0].destination).toEqual({ kind: 'phone', masked: '+222****3456', canSend: false });

      await make().list('COMPLETED');
      expect(prisma.accountRecoveryRequest.findMany.mock.calls[1][0].where).toEqual({ status: 'COMPLETED' });
    });
  });

  describe('the customer finishes with the code', () => {
    const live = { id: 't1', codeHash: sha('246810'), attempts: 0, expiresAt: new Date(Date.now() + 60_000) };

    it('sets the password, makes the new number the account\'s (verified) and ends every session', async () => {
      prisma.verificationToken.findFirst.mockResolvedValue(live);
      const res = await make().complete({ contact: NEW, code: '246810', newPassword: NEW_PASSWORD }, META);

      expect(res.identifier).toBe(NEW);
      const data = prisma.user.update.mock.calls[0][0].data;
      expect(data).toMatchObject({ passwordHash: '$argon2id$new', phone: NEW });
      expect(data.phoneVerifiedAt).toBeInstanceOf(Date);
      expect(prisma.accountRecoveryRequest.update.mock.calls[0][0].data.status).toBe('COMPLETED');
      expect(tokens.revokeAllForUser).toHaveBeenCalledWith('u1');
      expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe('recovery.completed');
    });

    it('a wrong code changes nothing and counts against this device', async () => {
      prisma.verificationToken.findFirst.mockResolvedValue(live);
      await expect(make().complete({ contact: NEW, code: '000000', newPassword: NEW_PASSWORD }, META)).rejects.toMatchObject({ response: { error: 'INVALID_CODE' } });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.loginAttempt.create.mock.calls[0][0].data).toMatchObject({ identifier: NEW, success: false });
    });

    it('no verified request for that contact looks exactly like a wrong code', async () => {
      prisma.accountRecoveryRequest.findFirst.mockResolvedValue(null);
      await expect(make().complete({ contact: NEW, code: '246810', newPassword: NEW_PASSWORD }, META)).rejects.toMatchObject({ response: { error: 'INVALID_CODE' } });
    });

    it('a contact taken meanwhile answers RECOVERY_CONTACT_TAKEN', async () => {
      prisma.verificationToken.findFirst.mockResolvedValue(live);
      prisma.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '6' }));
      await expect(make().complete({ contact: NEW, code: '246810', newPassword: NEW_PASSWORD }, META)).rejects.toMatchObject({ response: { error: 'RECOVERY_CONTACT_TAKEN' } });
    });
  });
});
