import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const stop = this.metrics.httpDuration.startTimer();

    const record = (status: number) =>
      stop({
        method: req.method,
        // The route pattern, not the URL: /orders/:id keeps cardinality bounded
        // where /orders/<uuid> would create a time series per order.
        route: req.route?.path ?? 'unmatched',
        status: String(status),
      });

    return next.handle().pipe(
      tap({
        next: () => record(res.statusCode),
        error: (err: { status?: number }) => record(err?.status ?? 500),
      }),
    );
  }
}
