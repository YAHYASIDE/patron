import { Injectable, Logger } from '@nestjs/common';
import { OrderItemStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { ProviderRegistry } from './provider-registry.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { TracingService } from '../../common/tracing/tracing.service';
import { FulfilOutcome } from './adapters/provider-adapter.interface';

export interface FulfilmentResult {
  status: OrderItemStatus;
  providerId?: string;
  providerRef?: string;
  error?: string;
}

/**
 * Executes fulfilment for a single order item, provider-agnostically.
 *
 * Failover: walks candidate providers in priority order until one delivers.
 * A non-retryable failure (bad player ID, product discontinued) stops the walk
 * immediately — trying the next provider would just fail identically and burn
 * money on a second attempt.
 *
 * Every attempt is recorded in provider_calls before the result is applied, so
 * a crash mid-fulfilment leaves evidence rather than a silent gap.
 */
@Injectable()
export class ProviderEngine {
  private readonly logger = new Logger(ProviderEngine.name);

  constructor(
    private prisma: PrismaService,
    private registry: ProviderRegistry,
    private crypto: CryptoService,
    private metrics: MetricsService,
    private tracing: TracingService,
  ) {}

  async fulfilItem(orderItemId: string, forceProviderId?: string): Promise<FulfilmentResult> {
    const item = await this.claim(orderItemId);
    if (!item) return { status: 'PROCESSING' }; // another worker owns it

    const candidates = forceProviderId
      ? await this.prisma.productProvider.findMany({
          where: { productId: item.productId, providerId: forceProviderId },
          include: { provider: true },
        })
      : await this.registry.candidatesFor(item.productId);

    if (candidates.length === 0) {
      return this.fail(item.id, 'no_provider', 'No healthy provider is configured for this product');
    }

    const inputs = this.decryptInputs(item.inputs);
    let lastError = 'Fulfilment failed';
    let previousProviderCode: string | undefined;

    for (const candidate of candidates) {
      const { adapter, creds, code } = await this.registry.credentialsFor(candidate.providerId);

      // Distinguishing a failover from a first attempt is what makes
      // "the primary is degraded" visible before customers notice.
      if (previousProviderCode) {
        this.metrics.providerFailovers.inc({ from_provider: previousProviderCode, to_provider: code });
      }
      const stopTimer = this.metrics.providerDuration.startTimer({ provider: code, operation: 'fulfil' });

      // Stable across retries of the same attempt number so a timeout followed
      // by a retry returns the provider's original order, not a second one.
      const idempotencyKey = this.crypto.sha256(`${item.id}:${candidate.providerId}:${item.attemptCount}`).slice(0, 40);
      const startedAt = Date.now();
      let outcome: FulfilOutcome;

      try {
        // The span an engineer actually wants when an order is stuck: one
        // provider attempt, with enough attributes to answer "which provider,
        // which SKU, which attempt" without opening the database.
        outcome = await this.tracing.withSpan(
          'provider.fulfil',
          {
            'patron.provider': code,
            'patron.provider_sku': candidate.providerSku,
            'patron.order_item_id': item.id,
            'patron.attempt': item.attemptCount,
            'patron.quantity': item.quantity,
          },
          async (span) => {
            const result = await adapter.fulfil(
              {
                idempotencyKey,
                providerSku: candidate.providerSku,
                quantity: item.quantity,
                inputs,
                reference: item.id,
              },
              creds,
            );
            span.setAttribute('patron.outcome', result.status);
            if (result.status === 'FAILED') {
              span.setAttribute('patron.error_code', result.errorCode);
              span.setAttribute('patron.retryable', result.retryable);
            }
            return result;
          },
        );
      } catch (err) {
        outcome = {
          status: 'FAILED',
          errorCode: 'adapter_exception',
          errorMessage: (err as Error).message,
          retryable: true,
          raw: null,
        };
      }

      stopTimer();
      this.metrics.providerCalls.inc({
        provider: code,
        operation: 'fulfil',
        result: outcome.status.toLowerCase(),
      });

      await this.recordCall(item.id, candidate.providerId, idempotencyKey, {
        sku: candidate.providerSku,
        quantity: item.quantity,
        inputKeys: Object.keys(inputs), // values may be personal data — keys only
      }, outcome, Date.now() - startedAt, item.attemptCount);

      if (outcome.status === 'DELIVERED') {
        await this.deliver(item.id, candidate.providerId, outcome);
        this.metrics.fulfilmentAttempts.inc({ result: 'delivered' });
        return { status: 'DELIVERED', providerId: candidate.providerId, providerRef: outcome.providerRef };
      }

      if (outcome.status === 'PENDING') {
        await this.prisma.orderItem.update({
          where: { id: item.id },
          data: { fulfilledByProviderId: candidate.providerId, status: 'PROCESSING' },
        });
        return { status: 'PROCESSING', providerId: candidate.providerId, providerRef: outcome.providerRef };
      }

      lastError = `${outcome.errorCode}: ${outcome.errorMessage}`;
      previousProviderCode = code;
      await this.noteProviderFailure(candidate.providerId, outcome);

      // A definitive rejection will not change on the next provider either.
      if (!outcome.retryable) break;
      this.logger.warn(`Provider ${candidate.providerId} failed for item ${item.id}, trying next: ${lastError}`);
    }

    return this.fail(item.id, 'all_providers_failed', lastError);
  }

  /** Poll a provider for an item left PENDING. */
  async pollItem(orderItemId: string): Promise<FulfilmentResult> {
    const item = await this.prisma.orderItem.findUniqueOrThrow({
      where: { id: orderItemId },
      include: { providerCalls: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!item.fulfilledByProviderId) return { status: item.status };

    const ref = (item.providerCalls[0]?.responseBody as any)?.order_id
      ?? (item.providerCalls[0]?.responseBody as any)?.txn_id;
    if (!ref) return { status: item.status };

    const { adapter, creds } = await this.registry.credentialsFor(item.fulfilledByProviderId);
    const outcome = await adapter.checkStatus(String(ref), creds);

    if (outcome.status === 'DELIVERED') {
      await this.deliver(item.id, item.fulfilledByProviderId, outcome);
      return { status: 'DELIVERED', providerId: item.fulfilledByProviderId };
    }
    if (outcome.status === 'FAILED') {
      return this.fail(item.id, outcome.errorCode, outcome.errorMessage);
    }
    return { status: 'PROCESSING' };
  }

  // ─────────────── internals ───────────────

  /**
   * Atomically take ownership. The conditional update is the concurrency
   * guard: two workers handed the same job can't both start fulfilment,
   * because only one update matches PENDING/FAILED.
   */
  private async claim(orderItemId: string) {
    const { count } = await this.prisma.orderItem.updateMany({
      where: { id: orderItemId, status: { in: ['PENDING', 'FAILED'] } },
      data: { status: 'PROCESSING', attemptCount: { increment: 1 } },
    });
    if (count === 0) return null;

    return this.prisma.orderItem.findUniqueOrThrow({
      where: { id: orderItemId },
      include: { inputs: true },
    });
  }

  private decryptInputs(inputs: Array<{ fieldKey: string; value: string; isSensitive: boolean }>) {
    return Object.fromEntries(
      inputs.map((i) => [i.fieldKey, i.isSensitive ? this.crypto.decrypt(i.value) : i.value]),
    );
  }

  private async deliver(itemId: string, providerId: string, outcome: Extract<FulfilOutcome, { status: 'DELIVERED' }>) {
    await this.prisma.$transaction(async (tx) => {
      await tx.orderResult.createMany({
        data: outcome.results.map((r) => ({
          orderItemId: itemId,
          resultType: r.resultType,
          valueEnc: this.crypto.encrypt(r.value), // codes are secrets
          providerRef: outcome.providerRef,
        })),
      });
      await tx.orderItem.update({
        where: { id: itemId },
        data: {
          status: 'DELIVERED',
          fulfilledByProviderId: providerId,
          deliveredAt: new Date(),
          lastError: null,
        },
      });
    });
  }

  private async fail(itemId: string, code: string, message: string): Promise<FulfilmentResult> {
    this.metrics.fulfilmentAttempts.inc({ result: 'failed' });
    await this.prisma.orderItem.update({
      where: { id: itemId },
      data: { status: 'FAILED', lastError: `${code}: ${message}`.slice(0, 500) },
    });
    return { status: 'FAILED', error: message };
  }

  private recordCall(
    orderItemId: string,
    providerId: string,
    idempotencyKey: string,
    requestBody: Record<string, unknown>,
    outcome: FulfilOutcome,
    durationMs: number,
    attemptNo: number,
  ) {
    return this.prisma.providerCall.create({
      data: {
        providerId,
        orderItemId,
        endpoint: 'fulfil',
        idempotencyKey,
        requestBody: requestBody as Prisma.InputJsonValue,
        responseBody: (outcome as any).raw ?? Prisma.JsonNull,
        success: outcome.status !== 'FAILED',
        errorCode: outcome.status === 'FAILED' ? outcome.errorCode : null,
        errorMessage: outcome.status === 'FAILED' ? outcome.errorMessage.slice(0, 500) : null,
        attemptNo,
        durationMs,
      },
    });
  }

  /** Transport-level failures mark the provider unhealthy for the health job. */
  private async noteProviderFailure(providerId: string, outcome: FulfilOutcome) {
    if (outcome.status !== 'FAILED') return;
    if (outcome.errorCode === 'transport_error' || outcome.errorCode.startsWith('http_5')) {
      await this.prisma.provider.update({ where: { id: providerId }, data: { isHealthy: false } });
    }
  }
}
