import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'idempotent';
/** Requires an Idempotency-Key header; replays the stored response on retry. */
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);
