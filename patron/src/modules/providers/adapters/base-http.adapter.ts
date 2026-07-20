import { Logger } from '@nestjs/common';
import { ProviderCredentials } from './provider-adapter.interface';

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly body: unknown,
    /** Network blips and 5xx are worth retrying; 4xx generally are not. */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/**
 * Shared HTTP plumbing: timeouts, redaction, uniform error shape. Adapters
 * subclass this and implement only what is genuinely provider-specific.
 */
export abstract class BaseHttpAdapter {
  protected readonly logger = new Logger(this.constructor.name);

  protected async request<T>(
    creds: ProviderCredentials,
    path: string,
    init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const controller = new AbortController();
    // A provider that hangs must not hold a worker slot indefinitely.
    const timer = setTimeout(() => controller.abort(), creds.timeoutMs);
    const url = `${creds.baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;

    try {
      const res = await fetch(url, {
        method: init.method ?? 'POST',
        headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });

      const text = await res.text();
      const body = text ? this.safeJson(text) : null;

      if (!res.ok) {
        throw new ProviderHttpError(
          `${this.constructor.name} ${res.status} on ${path}`,
          res.status,
          body,
          res.status >= 500 || res.status === 429,
        );
      }
      return body as T;
    } catch (err) {
      if (err instanceof ProviderHttpError) throw err;
      const aborted = (err as Error).name === 'AbortError';
      throw new ProviderHttpError(
        aborted ? `Timed out after ${creds.timeoutMs}ms` : (err as Error).message,
        null,
        null,
        true, // transport failures are always retryable
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private safeJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  /**
   * Both adapters mapped transport exceptions to a FulfilOutcome identically.
   * Keeping one copy means a change to retry semantics cannot apply to one
   * provider and silently not the other.
   */
  protected toTransportFailure(err: unknown) {
    const e = err as ProviderHttpError;
    return {
      status: 'FAILED' as const,
      errorCode: e.status ? `http_${e.status}` : 'transport_error',
      errorMessage: e.message,
      retryable: e.retryable ?? true,
      raw: e.body ?? null,
    };
  }

  /** Strip credentials before anything is persisted to provider_calls. */
  protected redact(payload: Record<string, unknown>): Record<string, unknown> {
    const SECRETS = ['apiKey', 'api_key', 'token', 'secret', 'password', 'authorization', 'signature'];
    return Object.fromEntries(
      Object.entries(payload).map(([k, v]) => [
        k,
        SECRETS.some((s) => k.toLowerCase().includes(s.toLowerCase())) ? '[REDACTED]' : v,
      ]),
    );
  }
}
