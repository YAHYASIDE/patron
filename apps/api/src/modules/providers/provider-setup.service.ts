import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DeliveryMode, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { ProviderRegistry } from './provider-registry.service';
import { ProviderEngine } from './provider-engine.service';
import { hasCatalog } from './adapters/provider-adapter.interface';
import { ConnectProviderDto, LinkProductDto, ProviderLimitsDto } from './dto/provider-setup.dto';

const DEFAULTS: Record<string, { name: string; baseUrl: string }> = {
  gamesdrop: { name: 'GamesDrop', baseUrl: 'https://partner.gamesdrop.io' },
};

/**
 * What the owner does from the dashboard to sell through a supplier:
 * connect the account (token stored encrypted), search the supplier's
 * catalog, link a product to an offer with the most it may cost, run the
 * supplier's documented test order, and only then switch a product to
 * automatic delivery. Nothing here buys real stock.
 */
@Injectable()
export class ProviderSetupService {
  constructor(
    private prisma: PrismaService,
    private registry: ProviderRegistry,
    private crypto: CryptoService,
    private engine: ProviderEngine,
  ) {}

  async connect(dto: ConnectProviderDto, actorId: string) {
    const def = DEFAULTS[dto.code];
    this.registry.getAdapter(dto.code); // an adapter must exist
    const existing = await this.prisma.provider.findUnique({ where: { code: dto.code } });
    const extra = {
      ...((existing?.extraConfig as Record<string, unknown> | null) ?? {}),
      ...(dto.countryCode && { countryCode: dto.countryCode }),
      ...(dto.dailyLimit !== undefined && { dailyLimit: dto.dailyLimit }),
    };
    const data = {
      apiKeyEnc: this.crypto.encrypt(dto.apiKey.trim()),
      extraConfig: extra as Prisma.InputJsonValue,
      ...(dto.lowBalanceAlert !== undefined && { lowBalanceAlert: dto.lowBalanceAlert }),
      isHealthy: true,
    };
    const provider = existing
      ? await this.prisma.provider.update({ where: { id: existing.id }, data })
      : await this.prisma.provider.create({
          // a new supplier starts last in the failover order
          data: { code: dto.code, name: def.name, baseUrl: def.baseUrl, priority: 100, ...data },
        });
    await this.audit(actorId, existing ? 'providers.reconnect' : 'providers.connect', provider.id);
    return this.status(provider.id);
  }

  /** The connection as the dashboard shows it: never the token. */
  async status(providerId: string) {
    const p = await this.prisma.provider.findUnique({
      where: { id: providerId },
      include: { _count: { select: { products: true } } },
    });
    if (!p) throw new NotFoundException({ error: 'PROVIDER_NOT_FOUND', message: 'Unknown provider' });
    const extra = (p.extraConfig as Record<string, unknown> | null) ?? {};
    let balance: { balance: number; currency: string } | null = null;
    let healthy = false;
    try {
      const { adapter, creds } = await this.registry.credentialsFor(p.id);
      balance = await adapter.getBalance(creds);
      healthy = true;
      await this.prisma.provider.update({
        where: { id: p.id },
        data: {
          balance: balance.balance,
          isHealthy: true,
          lastHealthCheckAt: new Date(),
          // the supplier's currency, so margins are only computed like-for-like
          extraConfig: { ...extra, currency: balance.currency } as Prisma.InputJsonValue,
        },
      });
    } catch {
      await this.prisma.provider.update({ where: { id: p.id }, data: { isHealthy: false, lastHealthCheckAt: new Date() } });
    }
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      isActive: p.isActive,
      connected: healthy,
      balance,
      lowBalanceAlert: p.lowBalanceAlert === null ? null : Number(p.lowBalanceAlert),
      dailyLimit: typeof extra.dailyLimit === 'number' ? extra.dailyLimit : null,
      spentToday: await this.engine.spentToday(p.id),
      countryCode: typeof extra.countryCode === 'string' ? extra.countryCode : 'MR',
      linkedProducts: p._count.products,
    };
  }

  async setLimits(providerId: string, dto: ProviderLimitsDto, actorId: string) {
    const p = await this.prisma.provider.findUnique({ where: { id: providerId } });
    if (!p) throw new NotFoundException({ error: 'PROVIDER_NOT_FOUND', message: 'Unknown provider' });
    const extra = { ...((p.extraConfig as Record<string, unknown> | null) ?? {}) };
    if (dto.dailyLimit !== undefined) extra.dailyLimit = dto.dailyLimit;
    await this.prisma.provider.update({
      where: { id: p.id },
      data: {
        extraConfig: extra as Prisma.InputJsonValue,
        ...(dto.lowBalanceAlert !== undefined && { lowBalanceAlert: dto.lowBalanceAlert }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
    await this.audit(actorId, 'providers.limits', p.id);
    return this.status(p.id);
  }

  async catalog(providerId: string, q: { search?: string; category?: string; page?: number }) {
    const { adapter, creds } = await this.registry.credentialsFor(providerId);
    if (!hasCatalog(adapter)) {
      throw new BadRequestException({ error: 'CATALOG_UNSUPPORTED', message: 'This supplier has no catalog search' });
    }
    const res = await adapter.searchCatalog(creds, q);
    const linked = await this.prisma.productProvider.findMany({
      where: { providerId, providerSku: { in: res.offers.map((o) => o.sku) } },
      select: { providerSku: true, productId: true },
    });
    const bySku = new Map(linked.map((l) => [l.providerSku, l.productId]));
    return { total: res.total, offers: res.offers.map((o) => ({ ...o, linkedProductId: bySku.get(o.sku) ?? null })) };
  }

  /** Our products linked to this supplier, with the margin at today's prices. */
  async links(providerId: string) {
    const rows = await this.prisma.productProvider.findMany({
      where: { providerId },
      include: {
        product: { select: { id: true, nameAr: true, sku: true, sellPrice: true, currency: true, delivery: true } },
        provider: { select: { extraConfig: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => {
      const supplierCurrency = (r.provider.extraConfig as { currency?: string } | null)?.currency ?? null;
      const sell = Number(r.product.sellPrice);
      const cost = Number(r.providerCost);
      return {
        id: r.id,
        productId: r.productId,
        productName: r.product.nameAr,
        productSku: r.product.sku,
        sellPrice: sell,
        sellCurrency: r.product.currency,
        providerSku: r.providerSku,
        providerCost: cost,
        providerCurrency: supplierCurrency,
        // a margin across two currencies would be a made-up number
        margin: supplierCurrency === r.product.currency ? Math.round((sell - cost) * 10_000) / 10_000 : null,
        autoDelivery: r.isActive && r.product.delivery === DeliveryMode.AUTO_PROVIDER,
      };
    });
  }

  /**
   * Link a product to a supplier offer. The link starts OFF: the product keeps
   * its current (manual) delivery until the owner switches automatic delivery on.
   */
  async link(providerId: string, dto: LinkProductDto, actorId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId }, select: { id: true } });
    if (!product) throw new NotFoundException({ error: 'PRODUCT_NOT_FOUND', message: 'Unknown product' });
    try {
      const row = await this.prisma.productProvider.upsert({
        where: { productId_providerId: { productId: dto.productId, providerId } },
        update: { providerSku: dto.providerSku, providerCost: dto.providerCost, ...(dto.priority !== undefined && { priority: dto.priority }) },
        create: {
          productId: dto.productId,
          providerId,
          providerSku: dto.providerSku,
          providerCost: dto.providerCost,
          priority: dto.priority ?? 0,
          isActive: false,
        },
      });
      await this.audit(actorId, 'providers.link_product', row.id);
      return (await this.links(providerId)).find((l) => l.id === row.id);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({ error: 'OFFER_ALREADY_LINKED', message: 'This supplier offer is linked to another product' });
      }
      throw e;
    }
  }

  async unlink(linkId: string, actorId: string) {
    const row = await this.prisma.productProvider.findUnique({ where: { id: linkId } });
    if (!row) throw new NotFoundException({ error: 'LINK_NOT_FOUND', message: 'Unknown link' });
    await this.setAuto(linkId, false, actorId);
    await this.prisma.productProvider.delete({ where: { id: linkId } });
    await this.audit(actorId, 'providers.unlink_product', linkId);
    return { ok: true };
  }

  /**
   * Automatic delivery on: the link is active and the product is delivered by
   * the supplier. Off: back to manual delivery, so paid orders wait for the owner.
   */
  async setAuto(linkId: string, enabled: boolean, actorId: string) {
    const row = await this.prisma.productProvider.findUnique({ where: { id: linkId }, include: { provider: true } });
    if (!row) throw new NotFoundException({ error: 'LINK_NOT_FOUND', message: 'Unknown link' });
    if (enabled && !row.provider.isActive) {
      throw new BadRequestException({ error: 'PROVIDER_INACTIVE', message: 'Switch the supplier on first' });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.productProvider.update({ where: { id: linkId }, data: { isActive: enabled } });
      const otherActive = await tx.productProvider.count({ where: { productId: row.productId, isActive: true } });
      await tx.product.update({
        where: { id: row.productId },
        data: { delivery: otherActive > 0 ? DeliveryMode.AUTO_PROVIDER : DeliveryMode.MANUAL },
      });
    });
    await this.audit(actorId, enabled ? 'providers.auto_on' : 'providers.auto_off', linkId);
    return { id: linkId, autoDelivery: enabled };
  }

  /** The supplier's documented test purchase: proves the token and the flow without real stock. */
  async testOrder(providerId: string, actorId: string) {
    const { adapter, creds } = await this.registry.credentialsFor(providerId);
    if (!hasCatalog(adapter)) {
      throw new BadRequestException({ error: 'TEST_UNSUPPORTED', message: 'This supplier has no test order' });
    }
    const outcome = await adapter.testOrder(creds, randomUUID().replace(/-/g, '').slice(0, 20));
    await this.audit(actorId, 'providers.test_order', providerId);
    // the test key is synthetic, but codes are never echoed: say what happened only
    return outcome.status === 'FAILED'
      ? { ok: false, status: outcome.status, error: outcome.errorCode, message: outcome.errorMessage }
      : { ok: true, status: outcome.status, providerRef: outcome.providerRef };
  }

  private audit(actorId: string, action: string, entityId: string) {
    return this.prisma.auditLog.create({ data: { userId: actorId, action, entityType: 'Provider', entityId } });
  }
}
