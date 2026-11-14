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
  | 'order.failed'
  | 'order.cancelled'
  | 'refund.processed'
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
  'order.partially_completed': {
    type: 'order.delivered',
    ar: { title: 'سلّمنا جزءًا من طلبك', body: 'سلّمنا جزءًا من طلبك {{orderNumber}}، وما تعذّر تسليمه سنكمله يدويًا أو نعيد لك ثمنه.' },
    en: { title: 'Part of your order is delivered', body: 'Part of order {{orderNumber}} is delivered. What could not be, we will deliver by hand or refund.' },
    fr: { title: 'Commande livrée en partie', body: 'Une partie de la commande {{orderNumber}} est livrée. Le reste sera livré à la main ou remboursé.' },
  },
  'order.failed': {
    type: 'order.failed',
    ar: { title: 'تأخّر تسليم طلبك', body: 'لم نستطع تسليم طلبك {{orderNumber}} تلقائيًا. سنسلّمه يدويًا أو نعيد لك المبلغ كاملًا، ولا داعي للدفع مرة أخرى.' },
    en: { title: 'Your order is delayed', body: 'We could not deliver order {{orderNumber}} automatically. We will deliver it by hand or refund you in full; there is no need to pay again.' },
    fr: { title: 'Commande retardée', body: "La commande {{orderNumber}} n'a pas pu être livrée automatiquement. Nous la livrerons à la main ou vous rembourserons entièrement ; inutile de payer à nouveau." },
  },
  'refund.processed': {
    type: 'refund.processed',
    ar: { title: 'أعدنا لك المبلغ', body: 'أعدنا {{amount}} من طلبك {{orderNumber}} {{destinationAr}}.' },
    en: { title: 'Refund sent', body: 'We refunded {{amount}} from order {{orderNumber}} {{destinationEn}}.' },
    fr: { title: 'Remboursement effectué', body: 'Nous avons remboursé {{amount}} de la commande {{orderNumber}} {{destinationFr}}.' },
  },
  'order.cancelled': {
    type: 'order.cancelled',
    ar: { title: 'أُلغي طلبك', body: 'أُلغي طلبك {{orderNumber}} لأنه لم يُدفع في الوقت المحدد. إن كنت دفعت فعلًا، راسلنا من صفحة الطلب.' },
    en: { title: 'Your order was cancelled', body: 'Order {{orderNumber}} was cancelled because it was not paid in time. If you did pay, message us from the order page.' },
    fr: { title: 'Commande annulée', body: "La commande {{orderNumber}} a été annulée faute de paiement à temps. Si vous avez payé, écrivez-nous depuis la page de la commande." },
  },
};
