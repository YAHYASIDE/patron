import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AgentsService, shareLink } from './agents.service';
import { firstName, maskPhone } from './commission-rules';

/**
 * What an agent sees of their own account (`agents.self`). Everything is
 * scoped by the signed-in user's own agent row; a customer appears only by
 * first name and a masked number, and no other agent is ever reachable.
 */
@Injectable()
export class AgentSelfService {
  constructor(
    private prisma: PrismaService,
    private agents: AgentsService,
  ) {}

  private async mine(userId: string) {
    const agent = await this.prisma.agent.findUnique({
      where: { userId },
      select: {
        id: true, code: true, isActive: true, commissionType: true, commissionValue: true, createdAt: true,
        _count: { select: { referrals: true, orders: true } },
      },
    });
    if (!agent) throw new NotFoundException({ message: 'This account is not an agent', error: 'NOT_AN_AGENT' });
    return agent;
  }

  async me(userId: string) {
    const agent = await this.mine(userId);
    const [statement, paidOrders] = await Promise.all([
      this.agents.statement(agent.id),
      this.prisma.order.count({ where: { agentId: agent.id, status: { in: ['PAID', 'PROCESSING', 'PARTIALLY_COMPLETED', 'COMPLETED'] } } }),
    ]);
    return {
      code: agent.code,
      isActive: agent.isActive,
      rule: { type: agent.commissionType, value: agent.commissionValue.toString() },
      sharePath: `/?ref=${encodeURIComponent(agent.code)}`,
      shareLink: shareLink(agent.code),
      since: agent.createdAt,
      counts: { referrals: agent._count.referrals, orders: agent._count.orders, paidOrders },
      statement,
    };
  }

  async referrals(userId: string) {
    const agent = await this.mine(userId);
    const rows = await this.prisma.user.findMany({
      where: { referredByAgentId: agent.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, fullName: true, phone: true, createdAt: true, _count: { select: { orders: { where: { agentId: agent.id } } } } },
    });
    // no ids, no full names, no numbers: the agent recognises their people, nothing more
    return rows.map((u, i) => ({
      n: rows.length - i,
      name: firstName(u.fullName),
      phone: maskPhone(u.phone),
      joinedAt: u.createdAt,
      orders: u._count.orders,
    }));
  }

  async commissions(userId: string) {
    const agent = await this.mine(userId);
    const rows = await this.prisma.commission.findMany({
      where: { agentId: agent.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true, basis: true, amount: true, currency: true, status: true, voidReason: true,
        clawbackAmount: true, clawbackReason: true, clawbackAt: true,
        createdAt: true, earnedAt: true, paidAt: true, voidedAt: true,
        order: { select: { orderNumber: true, user: { select: { fullName: true } } } },
      },
    });
    return rows.map(({ order, ...c }) => ({
      ...c,
      // the order number is the customer's reference with the shop; the agent sees its last digits only
      order: `…${order.orderNumber.slice(-4)}`,
      customer: firstName(order.user.fullName),
    }));
  }
}
