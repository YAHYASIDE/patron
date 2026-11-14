import { request } from './api';

/** An agent's (مندوب) own page: GET /agent/me… (permission agents.self). */

export type AgentStatement = {
  currency: string;
  pending: { count: number; amount: string };
  earned: { count: number; amount: string };
  paid: { count: number; amount: string };
  void: { count: number; amount: string };
  clawback: { total: string; recovered: string; open: string };
  payouts: { count: number; total: string };
  balanceDue: string;
};

export type AgentMe = {
  code: string;
  isActive: boolean;
  rule: { type: 'PERCENT' | 'FIXED'; value: string };
  sharePath: string;
  shareLink: string | null;
  since: string;
  counts: { referrals: number; orders: number; paidOrders: number };
  statement: AgentStatement;
};

export type AgentReferral = { n: number; name: string; phone: string | null; joinedAt: string; orders: number };

export type AgentCommission = {
  id: string;
  basis: string;
  amount: string;
  currency: string;
  status: 'PENDING' | 'EARNED' | 'PAID' | 'VOID';
  voidReason: string | null;
  clawbackAmount: string | null;
  clawbackReason: string | null;
  createdAt: string;
  order: string;
  customer: string;
};

export const agentApi = {
  me: () => request<AgentMe>('/agent/me', { auth: true }),
  referrals: () => request<AgentReferral[]>('/agent/me/referrals', { auth: true }),
  commissions: () => request<AgentCommission[]>('/agent/me/commissions', { auth: true }),
};
