import { INestApplication, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Thin wrapper over PrismaClient.
 *
 * A soft-delete client extension used to live here. It was removed: every call
 * site passed `deletedAt: null` explicitly anyway, and an extension that
 * silently rewrites query semantics is a footgun — the day someone needs to
 * read a deleted row for an audit, the extension is the last place they look.
 * Explicit filters are longer and better.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log:
        process.env.NODE_ENV === 'development'
          ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
          : ['error'],
    });
  }

  async onModuleInit() {
    await this.$connect();

    // Slow-query logging in development. In production the same visibility
    // comes from Postgres `log_min_duration_statement` and OTel spans, without
    // the per-query overhead.
    if (process.env.NODE_ENV === 'development') {
      // PrismaClient only types `$on('query')` when the client is
      // parameterised with its log options; a narrow structural interface
      // states exactly what we rely on without widening to `any`.
      const withQueryEvents = this as unknown as {
        $on(event: 'query', listener: (e: { duration: number; query: string }) => void): void;
      };

      withQueryEvents.$on('query', (event) => {
        if (event.duration > 200) {
          this.logger.warn(`Slow query (${event.duration}ms): ${event.query.slice(0, 300)}`);
        }
      });
    }
  }

  enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', () => void app.close());
  }
}
