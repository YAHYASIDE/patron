import { PrismaClient } from '@prisma/client';

/**
 * Per-test database reset for integration suites.
 *
 * Loaded only by `jest-integration.json` (never the e2e config). Integration
 * suites seed their own fixtures in each `beforeEach`, so every test must start
 * from an empty database — otherwise a globally-unique value a previous test
 * left behind (a `gatewayRef`, order number or SKU) collides on the next
 * insert. E2E suites deliberately share state across ordered steps, so they are
 * NOT truncated.
 *
 * This runs after `setup.ts` (which sets DATABASE_URL and applies the
 * migrations) and before each suite's own `beforeEach`.
 */
let prisma: PrismaClient;

beforeAll(async () => {
  prisma = new PrismaClient();
  await prisma.$connect();
});

beforeEach(async () => {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length > 0) {
    const list = tables.map((t) => `"${t.tablename}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
});

afterAll(async () => {
  await prisma?.$disconnect();
});
