import { BadRequestException } from '@nestjs/common';
import { OrderItemStatus, OrderStatus } from '@prisma/client';

/**
 * Explicit transition table. Order status is derived, never set ad hoc — a
 * stray `status = COMPLETED` somewhere in the codebase is how a refunded order
 * ends up looking delivered.
 */
const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING_PAYMENT: ['PAID', 'CANCELLED', 'FAILED'],
  PAID: ['PROCESSING', 'REFUNDED', 'CANCELLED'],
  PROCESSING: ['COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED'],
  PARTIALLY_COMPLETED: ['COMPLETED', 'REFUNDED', 'FAILED'],
  COMPLETED: ['REFUNDED'],
  FAILED: ['REFUNDED', 'PROCESSING'], // retried by an operator
  REFUNDED: [],
  CANCELLED: [],
};

const ITEM_TRANSITIONS: Record<OrderItemStatus, OrderItemStatus[]> = {
  PENDING: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['DELIVERED', 'FAILED'],
  DELIVERED: ['REFUNDED'],
  FAILED: ['PROCESSING', 'CANCELLED', 'REFUNDED'],
  REFUNDED: [],
  CANCELLED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (from === to) return;
  if (!canTransition(from, to)) {
    throw new BadRequestException(`Illegal order transition ${from} → ${to}`);
  }
}

export function assertItemTransition(from: OrderItemStatus, to: OrderItemStatus): void {
  if (from === to) return;
  if (!ITEM_TRANSITIONS[from].includes(to)) {
    throw new BadRequestException(`Illegal order item transition ${from} → ${to}`);
  }
}

export const TERMINAL_ORDER_STATUSES: OrderStatus[] = ['COMPLETED', 'REFUNDED', 'CANCELLED'];

/**
 * Derive the order status from its items. Called after every fulfilment
 * attempt so the aggregate can never disagree with its parts.
 */
export function deriveOrderStatus(itemStatuses: OrderItemStatus[]): OrderStatus {
  if (itemStatuses.length === 0) return 'PROCESSING';

  const all = (s: OrderItemStatus) => itemStatuses.every((i) => i === s);
  const some = (s: OrderItemStatus) => itemStatuses.some((i) => i === s);

  if (all('REFUNDED')) return 'REFUNDED';
  if (all('CANCELLED')) return 'CANCELLED';
  if (all('DELIVERED')) return 'COMPLETED';
  if (all('FAILED')) return 'FAILED';
  if (some('PENDING') || some('PROCESSING')) return 'PROCESSING';
  // Nothing pending, and a mix of delivered and failed/refunded.
  if (some('DELIVERED')) return 'PARTIALLY_COMPLETED';
  return 'FAILED';
}
