import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  correlationId: string;
  userId?: string;
  ip?: string;
  path?: string;
  /** Set on jobs so a fulfilment log line traces back to the HTTP request. */
  jobId?: string;
}

/**
 * AsyncLocalStorage rather than a request-scoped provider.
 *
 * Request scoping in Nest forces the whole injection chain to be request-scoped,
 * which is a measurable throughput cost and does not reach queue workers at all.
 * ALS follows the async call stack into services, Prisma hooks and BullMQ
 * processors without touching any constructor.
 */
const storage = new AsyncLocalStorage<RequestContext>();

export const RequestContextStore = {
  run<T>(context: RequestContext, fn: () => T): T {
    return storage.run(context, fn);
  },
  get(): RequestContext | undefined {
    return storage.getStore();
  },
  correlationId(): string {
    return storage.getStore()?.correlationId ?? 'no-correlation-id';
  },
  set(patch: Partial<RequestContext>): void {
    const current = storage.getStore();
    if (current) Object.assign(current, patch);
  },
};
