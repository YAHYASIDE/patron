import { PrismaClient } from '@prisma/client';
import {
  applyStagingGuard,
  maskAccounts,
  STAGING_GUARD_KEY,
  TEST_ACCOUNT_NAME,
  TEST_ACCOUNT_NUMBER,
} from '../../src/bootstrap/staging-guard';

const real = () => String(20000000 + Math.floor(Math.random() * 9_000_000));

function fakePrisma(accounts: unknown, marker = false) {
  const settings = new Map<string, { key: string; value: unknown }>();
  if (accounts !== undefined) settings.set('payments.manual_accounts', { key: 'payments.manual_accounts', value: accounts });
  if (marker) settings.set(STAGING_GUARD_KEY, { key: STAGING_GUARD_KEY, value: {} });
  const systemSetting = {
    findUnique: jest.fn(({ where }: { where: { key: string } }) => Promise.resolve(settings.get(where.key) ?? null)),
    update: jest.fn(({ where, data }: { where: { key: string }; data: { value: unknown } }) => {
      settings.set(where.key, { key: where.key, value: data.value });
      return Promise.resolve();
    }),
    create: jest.fn(({ data }: { data: { key: string; value: unknown } }) => {
      settings.set(data.key, data);
      return Promise.resolve();
    }),
  };
  const client = { systemSetting, $transaction: (fn: (tx: unknown) => unknown) => fn({ systemSetting }) };
  return { client: client as unknown as PrismaClient, settings, systemSetting };
}

describe('staging guard', () => {
  it('replaces every real receiving number and keeps the rest of the account', () => {
    const n = real();
    const { accounts, masked } = maskAccounts([
      { id: 'bankily', countries: ['MR'], accountNumber: n, accountName: 'x', enabled: true },
      { id: 'moov-ml', countries: ['ML'], accountNumber: '', enabled: false },
    ]);
    expect(masked).toBe(1);
    expect(accounts[0]).toEqual({ id: 'bankily', countries: ['MR'], accountNumber: TEST_ACCOUNT_NUMBER, accountName: TEST_ACCOUNT_NAME, enabled: true });
    expect(accounts[1]).toEqual({ id: 'moov-ml', countries: ['ML'], accountNumber: '', enabled: false });
    expect(JSON.stringify(accounts)).not.toContain(n);
  });

  it('does nothing unless STAGING=true (the shop never sets it)', async () => {
    const { client, systemSetting } = fakePrisma([{ accountNumber: real() }]);
    expect(await applyStagingGuard(client, {})).toEqual({ ran: false, masked: 0 });
    expect(await applyStagingGuard(client, { STAGING: 'false' })).toEqual({ ran: false, masked: 0 });
    expect(systemSetting.findUnique).not.toHaveBeenCalled();
  });

  it('runs once per database on staging', async () => {
    const n = real();
    const { client, settings } = fakePrisma([{ id: 'a', accountNumber: n, enabled: true }]);
    expect(await applyStagingGuard(client, { STAGING: 'true' })).toEqual({ ran: true, masked: 1 });
    expect(JSON.stringify(settings.get('payments.manual_accounts')?.value)).not.toContain(n);
    expect(settings.has(STAGING_GUARD_KEY)).toBe(true);
    // a test number typed later in the staging dashboard is left alone
    settings.set('payments.manual_accounts', { key: 'payments.manual_accounts', value: [{ accountNumber: '11112222' }] });
    expect(await applyStagingGuard(client, { STAGING: 'true' })).toEqual({ ran: false, masked: 0 });
  });

  it('copes with a database that has no accounts yet', async () => {
    const { client, settings } = fakePrisma(undefined);
    expect(await applyStagingGuard(client, { STAGING: 'true' })).toEqual({ ran: true, masked: 0 });
    expect(settings.has('payments.manual_accounts')).toBe(false);
  });
});
