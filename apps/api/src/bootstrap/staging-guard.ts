/* eslint-disable no-console */
import { Prisma, PrismaClient } from '@prisma/client';

/** Settings marker: the guard ran once on this database. */
export const STAGING_GUARD_KEY = 'staging.guard.v1';
export const TEST_ACCOUNT_NUMBER = '00000000';
export const TEST_ACCOUNT_NAME = 'حساب تجريبي — لا تحوّل مالًا';

type Account = Record<string, unknown> & { accountNumber?: unknown; accountName?: unknown };

/**
 * The migrations load the owner's real receiving numbers into every new
 * database, the staging one included. A test shop must never show them: a
 * visitor who pays there would send real money. Every number becomes an
 * obvious test value; the rest of each account (countries, enabled, logo) is
 * kept so the checkout can still be tested.
 */
export function maskAccounts(accounts: unknown): { accounts: Account[]; masked: number } {
  if (!Array.isArray(accounts)) return { accounts: [], masked: 0 };
  let masked = 0;
  const out = accounts.map((a: Account) => {
    if (!a || typeof a !== 'object') return a;
    if (typeof a.accountNumber !== 'string' || !a.accountNumber || a.accountNumber === TEST_ACCOUNT_NUMBER) return a;
    masked++;
    return { ...a, accountNumber: TEST_ACCOUNT_NUMBER, accountName: TEST_ACCOUNT_NAME };
  });
  return { accounts: out, masked };
}

/**
 * Run by the Docker entrypoint only when STAGING=true (render.staging.yaml); the
 * shop's blueprint never sets it. Once per database (a settings marker), so
 * test numbers typed later in the staging dashboard are left alone.
 */
export async function applyStagingGuard(client?: PrismaClient, env = process.env): Promise<{ ran: boolean; masked: number }> {
  if (env.STAGING !== 'true') return { ran: false, masked: 0 };
  const prisma = client ?? new PrismaClient();
  try {
    if (await prisma.systemSetting.findUnique({ where: { key: STAGING_GUARD_KEY } })) return { ran: false, masked: 0 };
    const row = await prisma.systemSetting.findUnique({ where: { key: 'payments.manual_accounts' } });
    const { accounts, masked } = maskAccounts(row?.value);
    await prisma.$transaction(async (tx) => {
      if (row && masked) {
        await tx.systemSetting.update({
          where: { key: 'payments.manual_accounts' },
          data: { value: accounts as Prisma.InputJsonValue },
        });
      }
      await tx.systemSetting.create({
        data: {
          key: STAGING_GUARD_KEY,
          group: 'staging',
          description: 'Receiving numbers replaced with test values on this staging database',
          value: { appliedAt: new Date().toISOString(), masked } as Prisma.InputJsonValue,
        },
      });
    });
    console.log(`staging guard: ${masked} receiving number(s) replaced with test values`);
    return { ran: true, masked };
  } finally {
    if (!client) await prisma.$disconnect();
  }
}
