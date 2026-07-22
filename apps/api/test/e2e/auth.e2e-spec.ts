import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/common/prisma/prisma.service';

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
    const known = await http().post('/auth/forgot-password').send({ email }).expect(200);
    const unknown = await http().post('/auth/forgot-password')
      .send({ email: `ghost-${Date.now()}@t.local` }).expect(200);

    expect(known.body).toEqual(unknown.body);
  });

  it('never returns a password hash', async () => {
    const login = await http().post('/auth/login').send({ email, password });
    const me = await http().get('/auth/me').set('authorization', `Bearer ${login.body.accessToken}`);

    expect(JSON.stringify(me.body)).not.toContain('passwordHash');
  });
});
