import {
  ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { trace } from '@opentelemetry/api';
import { RequestContextStore } from '../context/request-context';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  correlationId: string;
  traceId?: string;
  timestamp: string;
  path: string;
}

/**
 * One error shape for every failure, including the ones nobody anticipated.
 *
 * Two properties matter. First, the client always gets the same envelope, so
 * error handling is written once rather than per endpoint. Second, every
 * response carries the correlation id — when a customer reports a failure, that
 * string is the whole investigation, instead of "sometime this afternoon".
 *
 * Unhandled exceptions return a generic message. Stack traces and internal
 * detail go to the logs, never to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<{ url: string; method: string }>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';

    if (isHttp) {
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        message = payload;
        error = exception.name.replace(/Exception$/, '');
      } else {
        const body = payload as { message?: string | string[]; error?: string };
        message = body.message ?? exception.message;
        error = body.error ?? exception.name.replace(/Exception$/, '');
      }
    }

    const body: ErrorBody = {
      statusCode: status,
      error,
      message,
      correlationId: RequestContextStore.correlationId(),
      traceId: trace.getActiveSpan()?.spanContext().traceId,
      timestamp: new Date().toISOString(),
      path: req.url,
    };

    if (status >= 500) {
      // The full exception goes here and only here.
      this.logger.error(
        `${req.method} ${req.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res.status(status).json(body);
  }
}
