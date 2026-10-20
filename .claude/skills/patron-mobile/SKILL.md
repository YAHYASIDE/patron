---
name: patron-mobile
description: >-
  Patron Flutter apps: apps/admin_app (the owner's Android app — login with
  biometric unlock, attention list, staff notifications, optional bank-notification
  reading with NotificationListenerService) and apps/mobile (customer app scaffold).
  Use for "تطبيق الهاتف", "Flutter", "Android", "APK", "إشعارات البنك",
  NotificationListenerService, local_auth, or mobile CI.
---

# Patron mobile

## Apps
- `apps/admin_app`: staff app. Talks to `/api/v1` (`/auth/login`, `/admin/orders/attention`,
  `/admin/staff-notifications`, `/admin/bank-notices`). Tokens in flutter_secure_storage;
  biometric unlock via local_auth.
- Android package `com.patron.patron_admin`; native listener in
  `android/app/src/main/kotlin/com/patron/patron_admin/BankNotificationListener.kt`; masking in
  `lib/bank/sensitive_filter.dart` (mirrored in Kotlin `SensitiveText.kt`); queue `lib/bank/notice_queue.dart`.
- `apps/mobile`: customer app scaffold (structure only until scoped).
Both are outside the npm/Turbo graph; CI runs `flutter pub get`, `flutter analyze`, `flutter test`
per app ("Mobile · analyze & test", "Admin app · analyze & test").

## Bank notification reading (Android only, optional)
- Kotlin `NotificationListenerService` declared with `BIND_NOTIFICATION_LISTENER_SERVICE`. Access is
  granted ONLY by the phone owner in Android settings; the app just opens that screen.
- Reads only the bank apps the owner selected; masks/drops OTP, PIN and password-like text before
  anything leaves the listener; queues and retries uploads; the server dedupes by fingerprint.
- Evidence only: nothing in the app or the server confirms a payment from a notification.
- iOS cannot read other apps' notifications: the feature is hidden there.

## Procedure
Flutter SDK is not in the container by default: install into the scratchpad
(`git clone https://github.com/flutter/flutter.git -b stable --depth 1`) or rely on CI. Never commit
the SDK. Build an APK with `flutter build apk --release` (needs the Android SDK; do it in CI or on a
workstation).

## Verify this skill worked
`flutter analyze` clean and `flutter test` green (locally or in CI); on a phone: grant access, post a
test notification from an allowed app, see it in the dashboard's /bank-notices as evidence.
