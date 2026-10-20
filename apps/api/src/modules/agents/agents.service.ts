import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { countryFromPhone } from '../../common/reference/phone-country';
import { D } from '../../common/money/money';
import { CreateAgentDto, QueryAgentsDto, RecordPayoutDto, UpdateAgentDto } from './agents.dto';
import { generateCode } from './commission-rules';
import { allocateClawbacks, buildStatement, StatusGroup } from './statement';

const STATEMENT_SUMS = { amount: true, clawbackAmount: true, clawbackRecovered: true } as const;

/** Where a share link points: the store's address when it is configured. */
export function shareLink(code: string): string | null {
  const store = (process.env.STOREFRONT_URL ?? '').replace(/\/+$/, '');
  return store ? `${store}/?ref=${encodeURIComponent(code)}` : null;
}

/** The owner's side of agents: accounts, rules, statements and payouts (`agents.manage`). */
@Injectable()
export class AgentsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private config: ConfigService,
  ) {}

  private get baseCurrency() {
    return this.config.get<string>('currency.base') ?? 'USD';
  }

  async create(dto: CreateAgentDto, actorId: string) {
    if (dto.commissionType === 'PERCENT' && dto.commissionValue > 100) {
      throw new BadRequestException({ message: 'A percentage cannot exceed 100', error: 'PERCENT_TOO_HIGH' });
    }
    if (dto.code && (await this.prisma.agent.findUnique({ where: { code: dto.code } }))) {
      throw new ConflictException({ message: 'This code is taken', error: 'CODE_TAKEN' });
    }
    const code = dto.code ?? (await this.freeCode());

    const agentRole = await this.prisma.role.findUnique({ where: { name: 'agent' } });
    if (!agentRole) throw new BadRequestException({ message: 'Agent role missing — run the migrations', error: 'ROLE_MISSING' });

    const agent = await this.prisma.$transaction(async (tx) => {
      const userId = await this.resolveUser(tx, dto);
      if (await tx.agent.findUnique({ where: { userId } })) {
        throw new ConflictException({ message: 'This account is already an agent', error: 'AGENT_EXISTS' });
      }
      const created = await tx.agent.create({
        data: {
          userId,
          code,
          commissionType: dto.commissionType,
          commissionValue: D(dto.commissionValue),
          note: dto.note?.trim() || null,
        },
      });
      // the agent keeps their customer account and gains the agent page
      await tx.userRole.createMany({ data: [{ userId, roleId: agentRole.id }], skipDuplicates: true });
      await this.audit.record(tx, {
        actorId, action: 'agents.create', entityType: 'Agent', entityId: created.id,
        after: { userId, code, commissionType: dto.commissionType, commissionValue: dto.commissionValue },
      });
      return created;
    });
    return this.findOne(agent.id);
  }

  /** The account to make an agent: by id, or by WhatsApp number (made if new, like a store sign-up). */
  private async resolveUser(tx: Prisma.TransactionClient, dto: CreateAgentDto): Promise<string> {
    if (dto.userId) {
      const user = await tx.user.findFirst({ where: { id: dto.userId, deletedAt: null }, select: { id: true } });
      if (!user) throw new NotFoundException({ message: 'User not found', error: 'USER_NOT_FOUND' });
      return user.id;
    }
    const phone = dto.phone as string;
    const found = await tx.user.findFirst({ where: { phone, deletedAt: null }, select: { id: true } });
    if (found) return found.id;
    if (!dto.fullName?.trim()) {
      throw new BadRequestException({ message: 'Enter the agent\'s full name', error: 'NAME_REQUIRED' });
    }
    const customer = await tx.role.findUnique({ where: { name: 'customer' } });
    const currency = this.baseCurrency;
    const user = await tx.user.create({
      data: {
        phone,
        fullName: dto.fullName.trim(),
        country: countryFromPhone(phone),
        defaultCurrency: currency,
        ...(customer && { roles: { create: { roleId: customer.id } } }),
        wallets: { create: { currencyCode: currency } },
      },
    });
    return user.id;
  }

  private async freeCode(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const code = generateCode(i < 10 ? 6 : 8);
      if (!(await this.prisma.agent.findUnique({ where: { code }, select: { id: true } }))) return code;
    }
    throw new ConflictException({ message: 'Could not find a free code, try again', error: 'CODE_TAKEN' });
  }

  async update(id: string, dto: UpdateAgentDto, actorId: string) {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.agent.findUnique({
        where: { id },
        select: { commissionType: true, commissionValue: true, isActive: true, note: true },
      });
      if (!before) throw new NotFoundException({ message: 'Agent not found', error: 'AGENT_NOT_FOUND' });
      const type = dto.commissionType ?? before.commissionType;
      const value = dto.commissionValue !== undefined ? D(dto.commissionValue) : before.commissionValue;
      if (type === 'PERCENT' && value.gt(100)) {
        throw new BadRequestException({ message: 'A percentage cannot exceed 100', error: 'PERCENT_TOO_HIGH' });
      }
      // a rule change applies to orders from now on: existing commissions keep the rule they were made with
      const after = await tx.agent.update({
        where: { id },
        data: {
          commissionType: type,
          commissionValue: value,
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
          ...(dto.note !== undefined && { note: dto.note?.trim() || null }),
        },
        select: { commissionType: true, commissionValue: true, isActive: true, note: true },
      });
      await this.audit.record(tx, { actorId, action: 'agents.update', entityType: 'Agent', entityId: id, before, after });
    });
    return this.findOne(id);
  }

  async findAll(query: QueryAgentsDto) {
    const search = query.search?.trim();
    const agents = await this.prisma.agent.findMany({
      where: {
        ...(query.active && { isActive: query.active === 'true' }),
        ...(search && {
          OR: [
            { code: { contains: search.toUpperCase() } },
            { user: { fullName: { contains: search, mode: 'insensitive' } } },
            { user: { phone: { contains: search.replace(/[^\d+]/g, '') || search } } },
          ],
        }),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true, code: true, isActive: true, commissionType: true, commissionValue: true, note: true, createdAt: true,
        user: { select: { id: true, fullName: true, phone: true } },
        _count: { select: { referrals: true, orders: true } },
      },
    });
    const ids = agents.map((a) => a.id);
    const [groups, payouts] = await Promise.all([
      this.prisma.commission.groupBy({ by: ['agentId', 'status'], where: { agentId: { in: ids } }, _count: { _all: true }, _sum: STATEMENT_SUMS }),
      this.prisma.agentPayout.groupBy({ by: ['agentId'], where: { agentId: { in: ids } }, _count: { _all: true }, _sum: { amount: true } }),
    ]);
    return agents.map(({ _count, ...a }) => {
      const mine = groups.filter((g) => g.agentId === a.id) as unknown as StatusGroup[];
      const paid = payouts.find((p) => p.agentId === a.id);
      return {
        ...a,
        referralsCount: _count.referrals,
        ordersCount: _count.orders,
        statement: buildStatement(mine, { count: paid?._count._all ?? 0, total: paid?._sum.amount ?? null }, this.baseCurrency),
      };
    });
  }

  async statement(agentId: string) {
    const [groups, payouts] = await Promise.all([
      this.prisma.commission.groupBy({ by: ['status'], where: { agentId }, _count: { _all: true }, _sum: STATEMENT_SUMS }),
      this.prisma.agentPayout.aggregate({ where: { agentId }, _count: { _all: true }, _sum: { amount: true } }),
    ]);
    return buildStatement(groups as unknown as StatusGroup[], { count: payouts._count._all, total: payouts._sum.amount }, this.baseCurrency);
  }

  async findOne(id: string) {
    const agent = await this.prisma.agent.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, fullName: true, phone: true, email: true, createdAt: true } },
        _count: { select: { referrals: true, orders: true } },
      },
    });
    if (!agent) throw new NotFoundException({ message: 'Agent not found', error: 'AGENT_NOT_FOUND' });

    const [statement, referrals, commissions, payouts] = await Promise.all([
      this.statement(id),
      this.prisma.user.findMany({
        where: { referredByAgentId: id, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true, fullName: true, phone: true, createdAt: true, _count: { select: { orders: true } } },
      }),
      this.prisma.commission.findMany({
        where: { agentId: id },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
          order: { select: { id: true, orderNumber: true, status: true, total: true, currency: true, user: { select: { id: true, fullName: true } } } },
        },
      }),
      this.prisma.agentPayout.findMany({
        where: { agentId: id },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { _count: { select: { commissions: true } } },
      }),
    ]);

    const { _count, ...rest } = agent;
    return {
      ...rest,
      shareLink: shareLink(agent.code),
      referralsCount: _count.referrals,
      ordersCount: _count.orders,
      statement,
      referrals: referrals.map(({ _count: c, ...u }) => ({ ...u, ordersCount: c.orders })),
      commissions,
      payouts: payouts.map(({ _count: c, ...p }) => ({ ...p, commissionsCount: c.commissions })),
    };
  }

  /**
   * Settle EARNED commissions in one locked transaction. The agent row is
   * locked first, so two payouts for the same agent run one after the other,
   * and each commission is claimed with a conditional update: a commission
   * already PAID (or voided meanwhile) makes the whole payout fail, so nothing
   * is ever paid twice. Open clawbacks are taken off the amount.
   */
  async recordPayout(agentId: string, dto: RecordPayoutDto, actorId: string) {
    const payout = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "agents" WHERE "id" = ${agentId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException({ message: 'Agent not found', error: 'AGENT_NOT_FOUND' });

      const ids = [...dto.commissionIds].sort();
      const rows = await tx.$queryRaw<{ id: string; amount: Prisma.Decimal; currency: string }[]>`
        SELECT "id", "amount", "currency" FROM "commissions"
        WHERE "id" = ANY(${ids}::uuid[]) AND "agentId" = ${agentId}::uuid
          AND "status" = 'EARNED' AND "payoutId" IS NULL
        ORDER BY "id" FOR UPDATE`;
      if (rows.length !== ids.length) {
        throw new ConflictException({
          message: 'Some of these commissions are not earned and unpaid any more — reload and try again',
          error: 'COMMISSION_NOT_PAYABLE',
        });
      }
      const gross = rows.reduce((a, r) => a.plus(D(r.amount)), D(0));

      const open = await tx.$queryRaw<{ id: string; clawbackAmount: Prisma.Decimal | null; clawbackRecovered: Prisma.Decimal | null }[]>`
        SELECT "id", "clawbackAmount", "clawbackRecovered" FROM "commissions"
        WHERE "agentId" = ${agentId}::uuid AND "clawbackAmount" > COALESCE("clawbackRecovered", 0)
        ORDER BY "clawbackAt" ASC, "id" ASC FOR UPDATE`;
      const { deducted, recoveries } = allocateClawbacks(gross, open);

      const created = await tx.agentPayout.create({
        data: {
          agentId,
          amount: gross.minus(deducted),
          currency: rows[0].currency,
          reference: dto.reference?.trim() || null,
          note: dto.note?.trim() || null,
          paidById: actorId,
          clawbackDeducted: deducted.gt(0) ? deducted : null,
        },
      });
      const { count } = await tx.commission.updateMany({
        where: { id: { in: ids }, agentId, status: 'EARNED', payoutId: null },
        data: { status: 'PAID', payoutId: created.id, paidAt: new Date() },
      });
      if (count !== ids.length) {
        throw new ConflictException({ message: 'These commissions changed meanwhile — reload and try again', error: 'COMMISSION_NOT_PAYABLE' });
      }
      for (const r of recoveries) {
        await tx.commission.update({ where: { id: r.id }, data: { clawbackRecovered: r.recovered } });
      }
      await this.audit.record(tx, {
        actorId, action: 'agents.payout', entityType: 'AgentPayout', entityId: created.id,
        after: {
          agentId, commissions: ids.length, gross: gross.toString(), clawbackDeducted: deducted.toString(),
          amount: created.amount.toString(), reference: created.reference,
        },
      });
      return created;
    });
    return { payout, statement: await this.statement(agentId) };
  }
}
