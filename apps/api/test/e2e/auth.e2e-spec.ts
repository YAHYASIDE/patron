import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { CryptoService } from '../../src/common/crypto/crypto.service';

describe('Auth & permissions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let email: string;
  const password = 'CorrectHorse1';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // Neutralise the rate limiter for this suite. It fires dozens of auth
      // requests from one IP in seconds — well past the `strict` tier (10/60s) —
      // so the real ThrottlerGuard would 429 requests that these auth/RBAC cases
      // need to succeed. Overriding the injected storage (not the guard, which
      // APP_GUARD builds from its class) is what actually takes effect: the
      // guard always reports zero prior hits and lets every request through.
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: () => Promise.resolve({ totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleRef.createNestApplication();
    // Mirror production (main.ts): reject unknown properties rather than silently
    // stripping them. The 'strips unknown properties' case asserts that 400.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.role.upsert({ where: { name: 'customer' }, update: {}, create: { name: 'customer', isSystem: true } });
    await prisma.currency.upsert({
      where: { code: 'USD' }, update: {},
      create: { code: 'USD', nameAr: 'د', nameEn: 'USD', symbol: '$', isBase: true },
    });
    email = `auth-${Date.now()}@test.local`;
  });

  // Account lockout counts failed attempts by IP *or* identifier within a
  // window. Across an ordered suite hitting the app from one IP, failures from
  // the lockout case would leak into later cases and 403 their logins. Clearing
  // the ledger before each test isolates them; the lockout case still records
  // and asserts on its own five failures, which happen after this hook runs.
  beforeEach(() => prisma.loginAttempt.deleteMany());

  afterAll(() => app.close());
  const http = () => request(app.getHttpServer());

  describe('WhatsApp number sign-in', () => {
    const phone = `+2224${String(Date.now()).slice(-7)}`;
    const relayed = async (purpose: 'PHONE_VERIFY' | 'PHONE_LOGIN') => {
      const t = await prisma.verificationToken.findFirstOrThrow({
        where: { purpose, consumedAt: null, user: { phone } },
        orderBy: { createdAt: 'desc' },
      });
      return app.get(CryptoService).decrypt(t.codeEnc!);
    };

    it('signs a new number straight in, unverified, and asks a name only for new numbers', async () => {
      await http().post('/auth/phone/start').send({ phone }).expect(400);
      const res = await http().post('/auth/phone/start').send({ phone, fullName: 'Sidi Ahmed' }).expect(200);
      expect(res.body.status).toBe('SIGNED_IN');

      const me = await http().get('/auth/me').set('authorization', `Bearer ${res.body.accessToken}`).expect(200);
      expect(me.body).toMatchObject({ phone, fullName: 'Sidi Ahmed', email: null, phoneVerifiedAt: null });
    });

    it('rejects a name in neither Arabic nor Latin letters', () =>
      http().post('/auth/phone/start').send({ phone: '+22249999999', fullName: 'Иван' }).expect(400));

    it('once verified, the number needs the relayed code to sign in again', async () => {
      const first = await http().post('/auth/phone/start').send({ phone, fullName: 'Sidi Ahmed' }).expect(200);
      const auth = `Bearer ${first.body.accessToken}`;
      await http().post('/auth/phone/request-code').set('authorization', auth).send({}).expect(200);
      await http().post('/auth/phone/verify').set('authorization', auth).send({ code: await relayed('PHONE_VERIFY') }).expect(200);

      const again = await http().post('/auth/phone/start').send({ phone, fullName: 'Someone Else' }).expect(200);
      expect(again.body).toEqual({ status: 'CODE_REQUIRED' });

      await http().post('/auth/phone/login').send({ phone, code: '000000' }).expect(400);
      const ok = await http().post('/auth/phone/login').send({ phone, code: await relayed('PHONE_LOGIN') }).expect(200);
      expect(ok.body.accessToken).toBeDefined();
    });

    it('keeps the relay queue to staff', async () => {
      const res = await http().post('/auth/phone/start').send({ phone: `+2223${String(Date.now()).slice(-7)}`, fullName: 'Customer' });
      await http().get('/admin/verifications/pending').set('authorization', `Bearer ${res.body.accessToken}`).expect(403);
    });
  });

  it('rejects a weak password at the boundary', () =>
    http().post('/auth/register').send({ email: `w-${Date.now()}@t.local`, password: 'short', fullName: 'W' })
      .expect(400));

  it('strips unknown properties instead of persisting them', async () => {
    const res = await http().post('/auth/register')
      .send({ email, password, fullName: 'Auth Test', isBlocked: false, roleIds: ['x'] })
      .expect(400); // forbidNonWhitelisted — silently dropping would be worse
    expect(res.body.message).toBeDefined();
  });

  it('registers successfully', async () => {
    const res = await http().post('/auth/register')
      .send({ email, password, fullName: 'Auth Test' }).expect(201);
    expect(res.body.accessToken).toBeDefined();
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    const wrongPassword = await http().post('/auth/login').send({ email, password: 'WrongHorse1' });
    const unknownUser = await http().post('/auth/login')
      .send({ email: `nobody-${Date.now()}@t.local`, password: 'WrongHorse1' });

    expect(wrongPassword.status).toBe(unknownUser.status);
    expect(wrongPassword.body.message).toBe(unknownUser.body.message);
  });

  it('locks out after repeated failures', async () => {
    const target = `lock-${Date.now()}@test.local`;
    await http().post('/auth/register').send({ email: target, password, fullName: 'Lock' });

    for (let i = 0; i < 5; i++) {
      await http().post('/auth/login').send({ email: target, password: 'WrongHorse1' });
    }
    const res = await http().post('/auth/login').send({ email: target, password });
    expect(res.status).toBe(403);
  });

  it('rotates the refresh token and revokes the old one', async () => {
    const login = await http().post('/auth/login')
      .send({ email, password }).expect(200);

    const rotated = await http().post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken }).expect(200);
    expect(rotated.body.refreshToken).not.toBe(login.body.refreshToken);

    // Replaying the original must revoke the whole family.
    await http().post('/auth/refresh').send({ refreshToken: login.body.refreshToken }).expect(401);
    await http().post('/auth/refresh').send({ refreshToken: rotated.body.refreshToken }).expect(401);
  });

  it('denies admin endpoints to a customer', async () => {
    const login = await http().post('/auth/login').send({ email, password });
    await http().get('/users').set('authorization', `Bearer ${login.body.accessToken}`).expect(403);
    await http().get('/roles').set('authorization', `Bearer ${login.body.accessToken}`).expect(403);
  });

  it('invalidates every session on password change', async () => {
    const target = `pw-${Date.now()}@test.local`;
    await http().post('/auth/register').send({ email: target, password, fullName: 'PW' });
    const login = await http().post('/auth/login').send({ email: target, password }).expect(200);

    await http().post('/auth/change-password')
      .set('authorization', `Bearer ${login.body.accessToken}`)
      .send({ currentPassword: password, newPassword: 'NewCorrectHorse2' })
      .expect(200);

    await http().post('/auth/refresh').send({ refreshToken: login.body.refreshToken }).expect(401);
  });

  it('does not leak whether an email is registered on password reset', async () => {
    // email is off in this suite (no RESEND_API_KEY): the answer depends on the server, not the account
    const known = await http().post('/auth/forgot-password').send({ email });
    const unknown = await http().post('/auth/forgot-password').send({ email: `ghost-${Date.now()}@t.local` });

    expect(known.status).toBe(unknown.status);
    expect(known.body.error).toBe('EMAIL_NOT_CONFIGURED');
    expect(unknown.body.error).toBe(known.body.error);
    expect(unknown.body.message).toBe(known.body.message);
  });

  it('does not leak whether a number is registered on password reset either', async () => {
    const phone = `+2225${String(Date.now()).slice(-7)}`;
    await http().post('/auth/phone/start').send({ phone, fullName: 'Reset Test' }).expect(200);
    const known = await http().post('/auth/forgot-password').send({ identifier: phone }).expect(200);
    const unknown = await http().post('/auth/forgot-password').send({ identifier: '+22259999999' }).expect(200);
    expect(known.body).toEqual(unknown.body);
  });

  it('signs in with a verified number and the password it added, and lists the device', async () => {
    const phone = `+2226${String(Date.now()).slice(-7)}`;
    const start = await http().post('/auth/phone/start').send({ phone, fullName: 'Password Phone' }).expect(200);
    const bearer = `Bearer ${start.body.accessToken}`;
    await http().post('/auth/password').set('authorization', bearer).send({ newPassword: password }).expect(403);

    await http().post('/auth/phone/request-code').set('authorization', bearer).send({}).expect(200);
    const t = await prisma.verificationToken.findFirstOrThrow({ where: { purpose: 'PHONE_VERIFY', consumedAt: null, user: { phone } } });
    await http().post('/auth/phone/verify').set('authorization', bearer).send({ code: app.get(CryptoService).decrypt(t.codeEnc!) }).expect(200);
    await http().post('/auth/password').set('authorization', bearer).send({ newPassword: password }).expect(200);

    const login = await http().post('/auth/login').set('user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1')
      .send({ identifier: phone, password }).expect(200);
    const sessions = await http().get('/auth/sessions').set('authorization', `Bearer ${login.body.accessToken}`).expect(200);
    expect(sessions.body).toHaveLength(2);
    expect(sessions.body[0]).toMatchObject({ current: true, deviceInfo: 'iPhone · Safari' });

    // sign the first device out: its access token stops working at once
    await http().delete(`/auth/sessions/${sessions.body[1].id}`).set('authorization', `Bearer ${login.body.accessToken}`).expect(200);
    await http().get('/auth/me').set('authorization', bearer).expect(401);
    const me = await http().get('/auth/me').set('authorization', `Bearer ${login.body.accessToken}`).expect(200);
    expect(me.body).toMatchObject({ hasPassword: true, passkeyCount: 0 });
    expect(JSON.stringify(me.body)).not.toContain('passwordHash');
  });

  it('takes a recovery request with the same answer either way, and keeps the review to staff', async () => {
    const body = { contact: '+22258888888', fullName: 'Lost Account', proof: 'Bought PUBG UC last week for 500 MRU' };
    const a = await http().post('/auth/recovery').send(body).expect(200);
    const b = await http().post('/auth/recovery').send({ ...body, contact: email }).expect(200);
    expect(a.body).toEqual(b.body);

    const login = await http().post('/auth/login').send({ email, password }).expect(200);
    await http().get('/admin/recovery').set('authorization', `Bearer ${login.body.accessToken}`).expect(403);
  });

  it('answers PASSKEYS_NOT_CONFIGURED without a store address, and refuses junk passkey bodies', async () => {
    const res = await http().post('/auth/passkeys/login/options').send({});
    if (process.env.STOREFRONT_URL || process.env.WEBAUTHN_ORIGINS) expect(res.status).toBe(200);
    else expect(res.body.error).toBe('PASSKEYS_NOT_CONFIGURED');
    await http().post('/auth/passkeys/login/verify').send({ challengeId: 'nope', response: {} }).expect(400);
  });

  it('never returns a password hash', async () => {
    const login = await http().post('/auth/login').send({ email, password });
    const me = await http().get('/auth/me').set('authorization', `Bearer ${login.body.accessToken}`);

    expect(JSON.stringify(me.body)).not.toContain('passwordHash');
  });
});
