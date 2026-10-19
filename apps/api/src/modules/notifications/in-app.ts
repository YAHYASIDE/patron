import { NotificationChannel, Prisma } from '@prisma/client';

/** One language's text for a notification. */
export interface LocalisedText {
  title: string;
  body: string;
}

/**
 * The notification types the store knows how to show (bell icon, link).
 * docs/api-contract-50.md lists them; `broadcast` is written by the owner's
 * "message all customers" tool.
 */
export type InAppType =
  | 'order.paid'
  | 'order.delivered'
  | 'payment.rejected'
  | 'support.reply'
  | 'watch.price'
  | 'watch.stock'
  | 'broadcast';

export interface InAppMessage {
  userId: string;
  type: InAppType;
  ar: LocalisedText;
  en: LocalisedText;
  /** The table has Arabic and English columns only; French travels in `data.fr`. */
  fr: LocalisedText;
  orderId?: string;
  productId?: string;
  /** A store path the bell opens, e.g. `/orders/<id>`. */
  link?: string;
  /** Extra deep-link fields (a rejection reason, a ticket id). */
  extra?: Record<string, unknown>;
  /**
   * At most one row per key and user. Queue jobs are delivered at least once,
   * so a retried job must not ring the bell twice for the same event.
   */
  dedupeKey?: string;
}

/**
 * Write one IN_APP notification row directly, without a template.
 *
 * A plain function over a Prisma client (or a transaction client) so a service
 * can call it inside its own transaction: the notification then exists exactly
 * when the change it announces does.
 */
export async function writeInAppNotification(db: Prisma.TransactionClient, msg: InAppMessage) {
  if (msg.dedupeKey) {
    const existing = await db.notification.findFirst({
      where: { userId: msg.userId, channel: NotificationChannel.IN_APP, data: { path: ['key'], equals: msg.dedupeKey } },
      select: { id: true },
    });
    if (existing) return null;
  }

  const data: Record<string, unknown> = {
    ...msg.extra,
    type: msg.type,
    ...(msg.orderId && { orderId: msg.orderId }),
    ...(msg.productId && { productId: msg.productId }),
    ...(msg.link && { link: msg.link }),
    ...(msg.dedupeKey && { key: msg.dedupeKey }),
    fr: { title: msg.fr.title, body: msg.fr.body },
  };

  return db.notification.create({
    data: {
      userId: msg.userId,
      channel: NotificationChannel.IN_APP,
      titleAr: msg.ar.title,
      bodyAr: msg.ar.body,
      titleEn: msg.en.title,
      bodyEn: msg.en.body,
      data: data as Prisma.InputJsonValue,
      sentAt: new Date(),
    },
  });
}

interface OrderEventText {
  type: InAppType;
  ar: LocalisedText;
  en: LocalisedText;
  fr: LocalisedText;
}

/**
 * Bell texts for the order events the outbox already emits. `{{orderNumber}}`
 * is filled in at send time. These win over a template's IN_APP text so every
 * row carries a `type`, a link and the French copy; the template still drives
 * email and push.
 */
export const ORDER_EVENT_TEXTS: Record<string, OrderEventText> = {
  'order.paid': {
    type: 'order.paid',
    ar: { title: 'تم تأكيد الدفع', body: 'استلمنا دفعة طلبك {{orderNumber}}، ونجهّزه الآن.' },
    en: { title: 'Payment confirmed', body: 'We received the payment for order {{orderNumber}} and are preparing it now.' },
    fr: { title: 'Paiement confirmé', body: 'Nous avons reçu le paiement de la commande {{orderNumber}} et la préparons.' },
  },
  'order.completed': {
    type: 'order.delivered',
    ar: { title: 'تم تسليم طلبك', body: 'طلبك {{orderNumber}} جاهز. افتحه لعرض ما استلمته.' },
    en: { title: 'Your order is delivered', body: 'Order {{orderNumber}} is ready. Open it to see what you received.' },
    fr: { title: 'Commande livrée', body: 'La commande {{orderNumber}} est prête. Ouvrez-la pour voir ce que vous avez reçu.' },
  },
};
