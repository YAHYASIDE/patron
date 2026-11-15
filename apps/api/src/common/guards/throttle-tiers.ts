import { ExecutionContext } from '@nestjs/common';

// @nestjs/throttler's metadata key for a route's per-tier limit (not exported by the package).
const THROTTLER_LIMIT = 'THROTTLER:LIMIT';

/**
 * Throttler v6 applies every named tier to every route. The tighter tiers are
 * meant for the few routes that ask for them (`@Throttle({ expensive: ... })`),
 * so this `skipIf` leaves a tier out wherever the route or its controller has
 * not opted in. Without it, the 5/min "expensive" tier capped the whole API,
 * and a customer was throttled after two catalog pages.
 */
export const optInTier =
  (name: string) =>
  (context: ExecutionContext): boolean =>
    Reflect.getMetadata(THROTTLER_LIMIT + name, context.getHandler()) === undefined &&
    Reflect.getMetadata(THROTTLER_LIMIT + name, context.getClass()) === undefined;
