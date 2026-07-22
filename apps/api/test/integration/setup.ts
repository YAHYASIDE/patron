import { execSync } from 'child_process';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

/**
 * Integration and e2e tests run against a real Postgres.
 *
 * Mocking Prisma would not exercise the parts most likely to break: CHECK
 * constraints, unique indexes, FOR UPDATE locking and transaction rollback —
 * which is precisely where the money bugs live.
 *
 * In CI the workflow already stands up a Postgres service and exports
 * DATABASE_URL (and has run `prisma migrate deploy` against it), so we use it
 * directly. Starting a *nested* testcontainer there duplicated the database and
 * strained the runner — that is what produced the intermittent `write EPIPE`
 * failures. Only when no DATABASE_URL is present (local dev without a database)
 * do we spin up a throwaway container and migrate it.
 *
 * Per-test isolation (truncation) lives in `truncate.ts`, loaded only by the
 * integration config — e2e suites deliberately share state across ordered
 * steps and must not be reset between tests.
 */
let container: StartedPostgreSqlContainer | undefined;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= 'a'.repeat(64);
  process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-chars';
  process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-chars';
  process.env.NODE_ENV = 'test';

  if (process.env.DATABASE_URL) {
    // CI (or a developer with a database already exported): use it as-is. The
    // workflow has already applied the migrations to this database.
    return;
  }

  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();

  // stdio: 'pipe', not 'inherit'. Inheriting jest's stdout makes the child's
  // migration output race the reporter's pipe and intermittently throw
  // `write EPIPE`. Capture it and only surface it if the migration fails.
  try {
    execSync('npx prisma migrate deploy', { env: process.env, stdio: 'pipe' });
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    process.stderr.write(`${e.stdout?.toString() ?? ''}${e.stderr?.toString() ?? ''}\n`);
    throw err;
  }
}, 120_000);

afterAll(async () => {
  await container?.stop();
});
