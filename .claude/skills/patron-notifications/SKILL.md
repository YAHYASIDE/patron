---
name: patron-notifications
description: >-
  Patron notifications for customers and staff: customer in-app notices from order
  events (paid, delivered, failed, cancelled, refunded), the owner's notification
  center (new orders, pending payments, failures, refunds, support, errors, backups,
  USDT, bank notices) with priorities, dedupe, reminders and muting, and the
  dashboard bell. Use for "إشعارات", "تنبيهات", "تذكير", alert noise or missed alerts.
---

# Patron notifications

## Two channels
1. **Customers**: outbox events (`order.<status>`, `refund.processed`…) → queues
   (`modules/queues/outbox-relay.service.ts` routes, `notifications.processor.ts` renders
   `notifications/in-app.ts` texts in ar/fr/en) → `Notification` rows shown in the store bell.
   Dedupe key `${type}:${refundId ?? orderId}`. WhatsApp messages to the owner stay Arabic.
2. **Staff**: `StaffNotificationsService.notify({type, priority, title, body, link, entityType,
   entityId, dedupeKey?})` (global, never throws) → `staff_notifications` with a unique
   `dedupeKey` (raising again refreshes/reopens, never stacks); `resolve(dedupeKey)` when handled.
   Producers live in `staff-notifications/staff-events.service.ts` (the outbox relay hands it every
   event; payments/refunds/support/feedback call it for actions without outbox events).
   API `GET /admin/staff-notifications?state=open|all|resolved` (+ read, read-all, resolve, prefs
   with muted types). Reminders: repeatable job re-raises open HIGH/URGENT notices after 15/30
   min, at most 6 times. Dashboard: `components/StaffBell.tsx`, `/notifications`.

## Adding a notice
- Pick a stable `type` (`domain.event`), priority by urgency (URGENT = money or customers
  blocked now), Arabic title/body that says what to do, a `link` to the dashboard page, and a
  dedupeKey per subject (`order.failed:<orderId>`).
- Resolve it where the subject is handled (approve/reject/deliver/refund), in the same code path.
- Raise from one place (the outbox consumer or the service that owns the change), not from UI.

## Tests
Unit tests for producers (raised on the event, resolved on handling), dedupe (two events → one
row), reminders cap, muting; e2e for the API contract; the Android admin app consumes the same API.

## Verify this skill worked
Trigger the event locally (e.g. a failed delivery) and see exactly one open notice with the right
link; handle it and see it resolved; a second trigger does not add a row.
