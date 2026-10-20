import {
  ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { Prisma } from '@prisma/client';
import { trace } from '@opentelemetry/api';
import { RequestContextStore } from '../context/request-context';
import { reportServerError } from './server-error-sink';

interface ErrorBody {
  [detail: string]: unknown;
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
    // what the code attached on purpose (which cart line, which field, the old and new rate…)
    let details: Record<string, unknown> = {};

    /**
     * Prisma errors carry the status in their code, not in an HttpException.
     * Without this a duplicate email is a 500 rather than a 409 — this mapping
     * previously lived in a separate PrismaExceptionFilter and was lost when
     * the filters were consolidated.
     *
     * Internal column names are deliberately not echoed back: `users_phone_key`
     * discloses schema to an attacker. The constraint is logged instead.
     */
    const prismaStatus = exception instanceof Prisma.PrismaClientKnownRequestError
      ? this.mapPrismaError(exception)
      : null;

    if (prismaStatus) {
      const body: ErrorBody = {
        statusCode: prismaStatus.status,
        error: prismaStatus.error,
        message: prismaStatus.message,
        correlationId: RequestContextStore.correlationId(),
        traceId: trace.getActiveSpan()?.spanContext().traceId,
        timestamp: new Date().toISOString(),
        path: req.url,
      };
      this.logger.warn(`${req.method} ${req.url} → ${prismaStatus.status} (Prisma ${exception instanceof Prisma.PrismaClientKnownRequestError ? exception.code : '?'})`);
      res.status(prismaStatus.status).json(body);
      return;
    }

    if (isHttp) {
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        message = payload;
        error = exception.name.replace(/Exception$/, '');
      } else {
        const body = payload as { message?: string | string[]; error?: string; statusCode?: number };
        message = body.message ?? exception.message;
        error = body.error ?? exception.name.replace(/Exception$/, '');
        // only for errors raised on purpose: an unexpected 5xx stays generic
        if (status < 500) {
          const reserved = new Set(['message', 'error', 'statusCode']);
          details = Object.fromEntries(Object.entries(body).filter(([k]) => !reserved.has(k)));
        }
      }
    }

    const body: ErrorBody = {
      ...details,
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
      reportServerError({
        message: exception instanceof Error ? exception.message : String(exception),
        method: req.method,
        path: req.url,
        status,
        correlationId: body.correlationId,
      });
    }

    res.status(status).json(body);
  }

  private mapPrismaError(
    exception: Prisma.PrismaClientKnownRequestError,
  ): { status: number; error: string; message: string } | null {
    const target = Array.isArray(exception.meta?.target)
      ? (exception.meta?.target as string[]).join(', ')
      : undefined;

    const FIELD_LABELS: Record<string, string> = {
      email: 'email address',
      phone: 'phone number',
      sku: 'SKU',
      slug: 'slug',
      code: 'code',
      orderNumber: 'order number',
      quoteNumber: 'quote number',
      gatewayRef: 'payment reference',
    };
    const label = target ? FIELD_LABELS[target] : undefined;

    switch (exception.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          error: 'Conflict',
          message: label ? `That ${label} is already in use` : 'This record already exists',
        };
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          error: 'Bad Request',
          message: 'Referenced record does not exist',
        };
      case 'P2025':
        return { status: HttpStatus.NOT_FOUND, error: 'Not Found', message: 'Record not found' };
      default:
        return null; // fall through to the generic 500 path
    }
  }
}
