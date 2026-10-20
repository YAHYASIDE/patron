jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
}));

import { Prisma } from '@prisma/client';
import * as webauthn from '@simplewebauthn/server';
import { PasskeysService } from '../../src/modules/auth/passkeys.service';

const wa = webauthn as jest.Mocked<typeof webauthn>;
const META = { ip: '1.2.3.4', userAgent: 'jest', deviceInfo: 'iPhone · Safari' };
const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

describe('PasskeysService', () => {
  let prisma: any;
  let tokens: any;
  let settings: Record<string, string | undefined>;
  let service: PasskeysService;

  const owner = { id: 'u1', email: null, isActive: true, isBlocked: false, deletedAt: null };
  const passkey = {
    id: 'pk1', userId: 'u1', credentialId: 'cred-1', publicKey: Buffer.from([1, 2, 3]), counter: BigInt(4),
    transports: ['internal'], user: owner,
  };
  const challenge = (over: Record<string, unknown> = {}) => ({
    id: 'ch1', userId: null, purpose: 'login', challenge: 'chal', expiresAt: new Date(Date.now() + 60_000), ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    settings = { 'auth.webauthn.origins': 'https://store.example.com/', 'auth.webauthn.rpName': 'patron' };
    prisma = {
      user: {
        findFirstOrThrow: jest.fn().mockResolvedValue({ id: 'u1', email: null, phone: '+22222123456', fullName: 'Sidi', passkeys: [{ credentialId: 'old', transports: ['internal'] }] }),
        update: jest.fn(),
      },
      webAuthnChallenge: {
        create: jest.fn().mockResolvedValue({ id: 'ch1' }),
        findUnique: jest.fn().mockResolvedValue(challenge()),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      passkey: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'pk-new', deviceName: data.deviceName })),
        findUnique: jest.fn().mockResolvedValue(passkey),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: jest.fn() },
    };
    tokens = { issue: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 }) };
    service = new PasskeysService(prisma, tokens, { get: (k: string) => settings[k] } as any);
  });

  it('takes the RP id from STOREFRONT_URL unless WEBAUTHN_RP_ID is set, and is off without either', () => {
    expect(service.relyingParty()).toEqual({ rpID: 'store.example.com', rpName: 'patron', origins: ['https://store.example.com'] });
    settings['auth.webauthn.rpId'] = 'example.com';
    expect(service.relyingParty()?.rpID).toBe('example.com');
    settings = {};
    expect(service.relyingParty()).toBeNull();
  });

  it('answers PASSKEYS_NOT_CONFIGURED when the store address is missing', async () => {
    settings = {};
    await expect(service.authenticationOptions()).rejects.toMatchObject({ response: { error: 'PASSKEYS_NOT_CONFIGURED' } });
  });

  describe('adding a passkey', () => {
    it('asks for the phone\'s own unlock, a discoverable key, and skips keys already added', async () => {
      wa.generateRegistrationOptions.mockResolvedValue({ challenge: 'reg-chal' } as any);
      const res = await service.registrationOptions('u1');

      expect(res).toEqual({ challengeId: 'ch1', options: { challenge: 'reg-chal' } });
      const opts = wa.generateRegistrationOptions.mock.calls[0][0];
      expect(opts).toMatchObject({
        rpID: 'store.example.com', userName: '+22222123456', userDisplayName: 'Sidi', attestationType: 'none',
        excludeCredentials: [{ id: 'old', transports: ['internal'] }],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required', authenticatorAttachment: 'platform' },
      });
      expect(Buffer.from(opts.userID as Uint8Array).toString('utf8')).toBe('u1');
      expect(prisma.webAuthnChallenge.create.mock.calls[0][0].data).toMatchObject({ userId: 'u1', purpose: 'register', challenge: 'reg-chal' });
    });

    it('stores only the public key, and audits it', async () => {
      prisma.webAuthnChallenge.findUnique.mockResolvedValue(challenge({ userId: 'u1', purpose: 'register' }));
      wa.verifyRegistrationResponse.mockResolvedValue({
        verified: true,
        registrationInfo: { credential: { id: 'cred-9', publicKey: new Uint8Array([9, 9]), counter: 0, transports: ['internal', 'hybrid'] } },
      } as any);

      await service.verifyRegistration('u1', { challengeId: 'ch1', response: { id: 'cred-9' } }, META);
      expect(wa.verifyRegistrationResponse.mock.calls[0][0]).toMatchObject({
        expectedChallenge: 'chal', expectedOrigin: ['https://store.example.com'], expectedRPID: 'store.example.com', requireUserVerification: true,
      });
      expect(prisma.passkey.create.mock.calls[0][0].data).toEqual({
        userId: 'u1', credentialId: 'cred-9', publicKey: Buffer.from([9, 9]), counter: BigInt(0),
        transports: ['internal', 'hybrid'], deviceName: 'iPhone · Safari',
      });
      expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'auth.passkey_added', entityId: 'pk-new' });
    });

    it('names the passkey after the phone when the client sends no label', async () => {
      prisma.webAuthnChallenge.findUnique.mockResolvedValue(challenge({ userId: 'u1', purpose: 'register' }));
      wa.verifyRegistrationResponse.mockResolvedValue({ verified: true, registrationInfo: { credential: { id: 'c', publicKey: new Uint8Array(), counter: 0 } } } as any);
      await service.verifyRegistration('u1', { challengeId: 'ch1', response: {} }, { ip: '1.1.1.1', userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126.0 Mobile Safari/537.36' });
      expect(prisma.passkey.create.mock.calls[0][0].data).toMatchObject({ deviceName: 'Android · Chrome', transports: [] });
    });

    it('refuses a response that does not verify', async () => {
      prisma.webAuthnChallenge.findUnique.mockResolvedValue(challenge({ userId: 'u1', purpose: 'register' }));
      wa.verifyRegistrationResponse.mockRejectedValue(new Error('Unexpected origin'));
      await expect(service.verifyRegistration('u1', { challengeId: 'ch1', response: {} }, META)).rejects.toMatchObject({ response: { error: 'PASSKEY_INVALID' } });
      wa.verifyRegistrationResponse.mockResolvedValue({ verified: false } as any);
      prisma.webAuthnChallenge.findUnique.mockResolvedValue(challenge({ userId: 'u1', purpose: 'register' }));
      await expect(service.verifyRegistration('u1', { challengeId: 'ch1', response: {} }, META)).rejects.toMatchObject({ response: { error: 'PASSKEY_INVALID' } });
      expect(prisma.passkey.create).not.toHaveBeenCalled();
    });

    it('a device added twice answers PASSKEY_EXISTS', async () => {
      prisma.webAuthnChallenge.findUnique.mockResolvedValue(challenge({ userId: 'u1', purpose: 'register' }));
      wa.verifyRegistrationResponse.mockResolvedValue({ verified: true, registrationInfo: { credential: { id: 'c', publicKey: new Uint8Array(), counter: 0 } } } as any);
      prisma.passkey.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '6' }));
      await expect(service.verifyRegistration('u1', { challengeId: 'ch1', response: {} }, META)).rejects.toMatchObject({ response: { error: 'PASSKEY_EXISTS' } });
    });

    it('a challenge from someone else, for the other purpose, or already used is refused', async () => {
      prisma.webAuthnChallenge.findUnique.mockResolvedValue(challenge({ userId: 'u2', purpose: 'register' }));
      await expect(service.verifyRegistration('u1', { challengeId: 'ch1', response: {} }, META)).rejects.toMatchObject({ response: { error: 'PASSKEY_CHALLENGE_EXPIRED' } });
      prisma.webAuthnChallenge.findUnique.mockResolvedValue(challenge({ userId: 'u1', purpose: 'login' }));
      await expect(service.verifyRegistration('u1', { challengeId: 'ch1', response: {} }, META)).rejects.toBeDefined();
      prisma.webAuthnChallenge.findUnique.mockResolvedValue(challenge({ userId: 'u1', purpose: 'register' }));
      prisma.webAuthnChallenge.deleteMany.mockResolvedValue({ count: 0 }); // expired or replayed
      await expect(service.verifyRegistration('u1', { challengeId: 'ch1', response: {} }, META)).rejects.toMatchObject({ response: { error: 'PASSKEY_CHALLENGE_EXPIRED' } });
    });
  });

  describe('signing in with a passkey', () => {
    const response = (over: Record<string, unknown> = {}) => ({ id: 'cred-1', response: { userHandle: b64url('u1') }, ...over });

    it('offers discoverable credentials and sweeps expired challenges', async () => {
      wa.generateAuthenticationOptions.mockResolvedValue({ challenge: 'login-chal' } as any);
      expect(await service.authenticationOptions()).toEqual({ challengeId: 'ch1', options: { challenge: 'login-chal' } });
      expect(wa.generateAuthenticationOptions.mock.calls[0][0]).toMatchObject({ allowCredentials: [], userVerification: 'required' });
      expect(prisma.webAuthnChallenge.deleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lt: expect.any(Date) } } });
    });

    it('signs the owner in, moves the counter and audits', async () => {
      wa.verifyAuthenticationResponse.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 5 } } as any);
      await service.verifyAuthentication({ challengeId: 'ch1', response: response() }, META);

      const args = wa.verifyAuthenticationResponse.mock.calls[0][0];
      expect(args.credential).toMatchObject({ id: 'cred-1', counter: 4 });
      expect(Buffer.from(args.credential.publicKey)).toEqual(Buffer.from([1, 2, 3]));
      expect(prisma.passkey.update.mock.calls[0][0].data.counter).toBe(BigInt(5));
      expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe('auth.login_passkey');
      expect(tokens.issue).toHaveBeenCalledWith('u1', null, { ip: META.ip, deviceInfo: META.deviceInfo, userAgent: 'jest' });
    });

    it('refuses an unknown credential, a user handle that is not the owner, and a failed check', async () => {
      prisma.passkey.findUnique.mockResolvedValueOnce(null);
      await expect(service.verifyAuthentication({ challengeId: 'ch1', response: response() }, META)).rejects.toMatchObject({ response: { error: 'PASSKEY_INVALID' } });

      await expect(service.verifyAuthentication({ challengeId: 'ch1', response: response({ response: { userHandle: b64url('u2') } }) }, META))
        .rejects.toMatchObject({ response: { error: 'PASSKEY_INVALID' } });

      wa.verifyAuthenticationResponse.mockResolvedValue({ verified: false } as any);
      await expect(service.verifyAuthentication({ challengeId: 'ch1', response: response() }, META)).rejects.toMatchObject({ response: { error: 'PASSKEY_INVALID' } });

      wa.verifyAuthenticationResponse.mockRejectedValue(new Error('counter went backwards'));
      await expect(service.verifyAuthentication({ challengeId: 'ch1', response: response() }, META)).rejects.toMatchObject({ response: { error: 'PASSKEY_INVALID' } });
      await expect(service.verifyAuthentication({ challengeId: 'ch1', response: {} }, META)).rejects.toMatchObject({ response: { error: 'PASSKEY_INVALID' } });
      expect(tokens.issue).not.toHaveBeenCalled();
    });

    it('a blocked or deleted account gets no session', async () => {
      wa.verifyAuthenticationResponse.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 5 } } as any);
      prisma.passkey.findUnique.mockResolvedValue({ ...passkey, user: { ...owner, isBlocked: true } });
      await expect(service.verifyAuthentication({ challengeId: 'ch1', response: response() }, META)).rejects.toMatchObject({ response: { error: 'ACCOUNT_BLOCKED' } });
      prisma.passkey.findUnique.mockResolvedValue({ ...passkey, user: { ...owner, isActive: false } });
      await expect(service.verifyAuthentication({ challengeId: 'ch1', response: response() }, META)).rejects.toMatchObject({ response: { error: 'ACCOUNT_INACTIVE' } });
      prisma.passkey.findUnique.mockResolvedValue({ ...passkey, user: { ...owner, deletedAt: new Date() } });
      await expect(service.verifyAuthentication({ challengeId: 'ch1', response: response() }, META)).rejects.toMatchObject({ response: { error: 'PASSKEY_INVALID' } });
      expect(tokens.issue).not.toHaveBeenCalled();
    });
  });

  it('lists my passkeys without key material and removes only mine', async () => {
    await service.list('u1');
    expect(prisma.passkey.findMany.mock.calls[0][0].select).toEqual({ id: true, deviceName: true, createdAt: true, lastUsedAt: true });

    await service.remove('u1', 'pk1', META);
    expect(prisma.passkey.deleteMany).toHaveBeenCalledWith({ where: { id: 'pk1', userId: 'u1' } });
    prisma.passkey.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.remove('u1', 'pk-of-someone-else', META)).rejects.toMatchObject({ response: { error: 'PASSKEY_NOT_FOUND' } });
  });
});
