import {
  BadRequestException, CallHandler, ExecutionContext, Injectable, NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { IdempotencyService } from './idempotency.service';
import { IDEMPOTENT_KEY } from './idempotent.decorator';
import { serialiseMoney } from '../money/money';
import { MetricsService } from '../metrics/metrics.service';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private idempotency: IdempotencyService,
    private reflector: Reflector,
    private metrics: MetricsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const required = this.reflector.get<boolean>(IDEMPOTENT_KEY, context.getHandler());
    if (!required) return next.handle();

    const req = context.switchToHttp().getRequest();
    const key = req.headers['idempotency-key'] as string | undefined;
    if (!key) throw new BadRequestException('Idempotency-Key header is required for this endpoint');
    if (key.length < 8 || key.length > 200) throw new BadRequestException('Idempotency-Key must be 8–200 characters');

    const hash = this.idempotency.hashRequest(req.body);
    const endpoint = `${req.method} ${req.route?.path ?? req.url}`;

    return from(this.idempotency.claim(key, endpoint, hash, req.user?.id)).pipe(
      switchMap((replay) => {
        if (replay) {
          this.metrics.idempotencyReplays.inc({ endpoint });
          return of(replay.body);
        }
        return next.handle().pipe(
          // Must complete before the response is emitted. Fire-and-forget left
          // a window where a fast retry arrived before the record was written
          // and was told the request was still in flight.
          switchMap(async (body) => {
            const status = context.switchToHttp().getResponse().statusCode ?? 200;
            await this.idempotency.complete(key, status, serialiseMoney(body));
            return body;
          }),
          catchError(async (err) => {
            await this.idempotency.release(key);
            throw err;
          }),
        );
      }),
    );
  }
}
