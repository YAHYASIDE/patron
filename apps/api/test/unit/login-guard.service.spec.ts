import { LoginGuardService } from '../../src/modules/auth/login-guard.service';

type Row = { identifier: string; ipAddress: string; success: boolean; reason?: string; createdAt: Date };

/** A loginAttempt table in memory that understands the filters the guard uses. */
function fakeAttempts() {
  const rows: Row[] = [];
  let clock = Date.now();
  const match = (r: Row, w: any) =>
    (w.identifier === undefined || r.identifier === w.identifier) &&
    (w.ipAddress === undefined || r.ipAddress === w.ipAddress) &&
    (w.success === undefined || r.success === w.success) &&
    (!w.createdAt?.gte || r.createdAt >= w.createdAt.gte) &&
    (!w.createdAt?.gt || r.createdAt > w.createdAt.gt);
  const sorted = (w: any) => rows.filter((r) => match(r, w)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return {
    rows,
    advance: (ms: number) => {
      clock += ms;
      jest.setSystemTime(clock);
    },
    loginAttempt: {
      create: jest.fn(({ data }: any) => {
        rows.push({ ...data, createdAt: new Date(clock) });
        return Promise.resolve(data);
      }),
      count: jest.fn(({ where }: any) => Promise.resolve(rows.filter((r) => match(r, where)).length)),
      findFirst: jest.fn(({ where }: any) => Promise.resolve(sorted(where)[0] ?? null)),
      findMany: jest.fn(({ where, take }: any) => Promise.resolve(sorted(where).slice(0, take))),
    },
  };
}

describe('LoginGuardService — brute force without owner lockout (M2)', () => {
  const OWNER = '+22222123456';
  const OWNER_IP = '41.188.1.10';
  const STRANGER_IP = '102.33.4.5';
  let db: ReturnType<typeof fakeAttempts>;
  let guard: LoginGuardService;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-20T10:00:00Z') });
    db = fakeAttempts();
    const config = { get: (k: string) => ({ 'security.maxLoginAttempts': 5, 'security.lockoutMinutes': 15, 'security.maxIpFailures': 30 })[k] };
    guard = new LoginGuardService(db as any, config as any);
  });
  afterEach(() => jest.useRealTimers());

  /** Fail as fast as the progressive delay allows. */
  async function failUntilLocked(identifier: string, ip: string, max = 5) {
    for (let i = 0; i < max; i++) {
      await guard.assertAllowed(identifier, ip);
      await guard.recordFailure(identifier, ip, 'invalid_credentials');
      db.advance(LoginGuardService.delayFor(i + 1) * 1000);
    }
  }

  it('locks the (identifier, IP) pair after repeated failures', async () => {
    await failUntilLocked(OWNER, STRANGER_IP);
    await expect(guard.assertAllowed(OWNER, STRANGER_IP)).rejects.toMatchObject({
      response: { error: 'TOO_MANY_ATTEMPTS' },
      status: 403,
    });
  });

  it('a stranger cannot lock the owner out of their own device', async () => {
    await failUntilLocked(OWNER, STRANGER_IP);
    await expect(guard.assertAllowed(OWNER, STRANGER_IP)).rejects.toBeDefined();

    // the owner, same number, own connection: no lock, no delay
    await expect(guard.assertAllowed(OWNER, OWNER_IP)).resolves.toBeUndefined();
  });

  it('slows guessing down progressively before the lock', async () => {
    await guard.recordFailure(OWNER, STRANGER_IP, 'x');
    await expect(guard.assertAllowed(OWNER, STRANGER_IP)).resolves.toBeUndefined(); // 1 failure: no wait

    await guard.recordFailure(OWNER, STRANGER_IP, 'x');
    await expect(guard.assertAllowed(OWNER, STRANGER_IP)).rejects.toMatchObject({ response: { retryAfter: 2 } });
    db.advance(2_000);
    await expect(guard.assertAllowed(OWNER, STRANGER_IP)).resolves.toBeUndefined();

    await guard.recordFailure(OWNER, STRANGER_IP, 'x');
    await expect(guard.assertAllowed(OWNER, STRANGER_IP)).rejects.toMatchObject({ response: { retryAfter: 4 } });
  });

  it('a success clears the pair, so the owner\'s own typos do not pile up', async () => {
    for (let i = 0; i < 3; i++) {
      await guard.recordFailure(OWNER, OWNER_IP, 'typo');
      db.advance(10_000);
    }
    await guard.recordSuccess(OWNER, OWNER_IP);
    db.advance(1000);
    await guard.recordFailure(OWNER, OWNER_IP, 'typo');
    await expect(guard.assertAllowed(OWNER, OWNER_IP)).resolves.toBeUndefined();
  });

  it('the lock lifts once the failures leave the window', async () => {
    await failUntilLocked(OWNER, STRANGER_IP);
    await expect(guard.assertAllowed(OWNER, STRANGER_IP)).rejects.toBeDefined();
    db.advance(15 * 60_000);
    await expect(guard.assertAllowed(OWNER, STRANGER_IP)).resolves.toBeUndefined();
  });

  it('keeps a global per-IP limit: one IP spraying many accounts is stopped everywhere', async () => {
    for (let i = 0; i < 30; i++) await guard.recordFailure(`+2222200${String(i).padStart(4, '0')}`, STRANGER_IP, 'x');

    await expect(guard.assertAllowed('+22233333333', STRANGER_IP)).rejects.toMatchObject({ response: { error: 'TOO_MANY_ATTEMPTS' } });
    // …but only that IP
    await expect(guard.assertAllowed('+22233333333', OWNER_IP)).resolves.toBeUndefined();
  });

  it('caps the delay', () => {
    expect([0, 1, 2, 3, 4, 10].map((n) => LoginGuardService.delayFor(n))).toEqual([0, 0, 2, 4, 8, 30]);
  });

  it('words a short wait in seconds and a lock in minutes', async () => {
    await guard.recordFailure(OWNER, STRANGER_IP, 'x');
    await guard.recordFailure(OWNER, STRANGER_IP, 'x');
    await expect(guard.assertAllowed(OWNER, STRANGER_IP)).rejects.toMatchObject({ response: { message: expect.stringMatching(/seconds/) } });
    await failUntilLocked('a@b.c', STRANGER_IP);
    await expect(guard.assertAllowed('a@b.c', STRANGER_IP)).rejects.toMatchObject({ response: { message: expect.stringMatching(/minutes/) } });
  });
});
