import { execSync } from 'child_process';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

/**
 * Integration and e2e tests run against a real Postgres in a container.
 *
 * Mocking Prisma would not exercise the parts most likely to break: CHECK
 * constraints, unique indexes, FOR UPDATE locking and transaction rollback —
 * which is precisely where the money bugs live.
 */
let container: StartedPostgreSqlContainer;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-chars';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-chars';
  process.env.NODE_ENV = 'test';

  execSync('npx prisma migrate deploy', { env: process.env, stdio: 'inherit' });
}, 120_000);

afterAll(async () => {
  await container?.stop();
});
