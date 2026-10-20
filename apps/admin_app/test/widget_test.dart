import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:patron_admin/api/api_client.dart';
import 'package:patron_admin/api/models.dart';
import 'package:patron_admin/app.dart';
import 'package:patron_admin/auth/biometric.dart';
import 'package:patron_admin/auth/session.dart';
import 'package:patron_admin/auth/token_store.dart';
import 'package:patron_admin/bank/bank_sync.dart';
import 'package:patron_admin/bank/listener_channel.dart';
import 'package:patron_admin/bank/notice_queue.dart';
import 'package:patron_admin/settings.dart';
import 'package:shared_preferences/shared_preferences.dart';

class FakeBiometric implements BiometricGate {
  FakeBiometric({this.available = true, this.succeed = true});

  bool available;
  bool succeed;
  int prompts = 0;

  @override
  Future<bool> isAvailable() async => available;

  @override
  Future<bool> authenticate(String reason) async {
    prompts++;
    return succeed;
  }
}

/// The iOS / non-Android case: the bank-reading feature is hidden.
class NoListener implements BankListenerPlatform {
  @override
  bool get supported => false;
  @override
  Future<bool> isAccessGranted() async => false;
  @override
  Future<void> openAccessSettings() async {}
  @override
  Future<ListenerConfig> getConfig() async => const ListenerConfig(enabled: false, packages: {});
  @override
  Future<void> setConfig(ListenerConfig config) async {}
  @override
  Future<List<CapturedNotice>> fetchPending() async => const [];
  @override
  Future<void> ack(List<String> ids) async {}
  @override
  Future<int> droppedCount() async => 0;
  @override
  Future<List<AppInfo>> describeApps(List<String> packages) async => const [];
  @override
  Future<List<AppInfo>> suggestApps() async => const [];
  @override
  Stream<void> get events => const Stream<void>.empty();
}

http.Response _json(Object body, [int status = 200]) =>
    http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json; charset=utf-8'});

Future<http.Response> fakeApi(http.Request req) async {
  final path = req.url.path;
  if (path.endsWith('/auth/login')) {
    return _json({'accessToken': 'a-${Random().nextInt(1 << 20)}', 'refreshToken': 'r-${Random().nextInt(1 << 20)}'});
  }
  if (path.endsWith('/admin/orders/attention')) {
    return _json({
      'total': 3,
      'failed': {
        'count': 2,
        'items': [
          {'id': 'o1', 'orderNumber': 'PTN-1', 'total': '100', 'currency': 'MRU', 'minutes': 30},
        ],
      },
      'lateDelivery': {'count': 0, 'items': []},
      'waitingTransfers': {'count': 1, 'items': []},
      'duplicatePayments': {'count': 0, 'items': []},
    });
  }
  if (path.endsWith('/admin/staff-notifications')) {
    return _json({
      'data': [
        {
          'id': 'n1',
          'type': 'payment.pending',
          'priority': 'HIGH',
          'title': 'تحويل ينتظر المراجعة',
          'body': 'الطلب PTN-2',
          'link': '/orders/o2',
          'createdAt': DateTime.now().toUtc().toIso8601String(),
          'readAt': null,
          'remindCount': 0,
        },
      ],
      'unread': 1,
      'open': 1,
    });
  }
  return _json({'statusCode': 404, 'error': 'Not Found'}, 404);
}

Future<AppServices> buildServices({TokenPair? saved, FakeBiometric? biometric}) async {
  SharedPreferences.setMockInitialValues({});
  final settings = AppSettings(await SharedPreferences.getInstance());
  final api = ApiClient(
    httpClient: MockClient(fakeApi),
    baseUrl: () => 'https://api.test/api/v1',
    tokens: MemoryTokenStore(saved),
  );
  final session = SessionController(api: api, biometric: biometric ?? FakeBiometric(), settings: settings);
  final bank = BankSync(
    platform: NoListener(),
    api: api,
    queue: NoticeQueue(store: MemoryQueueStore(), send: BankSync.senderFor(api, () => 'android-test')),
    deviceId: () => 'android-test',
    canUpload: () => session.state == SessionState.signedIn,
  );
  return AppServices(settings: settings, api: api, session: session, bank: bank, openUrl: (_) async => true);
}

void main() {
  testWidgets('signs in and shows attention counts and staff notifications', (tester) async {
    // A tall phone so the whole home list is built.
    tester.view.physicalSize = const Size(1080, 4000);
    tester.view.devicePixelRatio = 2.5;
    addTearDown(tester.view.reset);
    final services = await buildServices();
    await tester.pumpWidget(PatronAdminApp(services: services));
    await services.session.init();
    await tester.pumpAndSettle();

    // Arabic, right-to-left login.
    expect(find.text('تسجيل دخول فريق المتجر'), findsOneWidget);
    expect(Directionality.of(tester.element(find.byType(TextFormField).first)), TextDirection.rtl);

    await tester.enterText(find.byType(TextFormField).at(0), 'owner@shop.test');
    await tester.enterText(find.byType(TextFormField).at(1), 'pw-${Random().nextInt(999)}');
    await tester.tap(find.text('دخول'));
    await tester.pumpAndSettle();

    expect(services.session.state, SessionState.signedIn);
    expect(find.text('ما يحتاج انتباهك'), findsOneWidget);
    expect(find.text('2'), findsWidgets); // failed count
    expect(find.text('فشل التسليم (2)'), findsOneWidget);
    expect(find.text('تحويل ينتظر المراجعة'), findsOneWidget);
    expect(find.text('مهم'), findsOneWidget); // HIGH priority chip

    // Bank tab works without the Android listener (iOS): no reading card.
    await tester.tap(find.text('إشعارات البنك').last);
    await tester.pumpAndSettle();
    expect(find.text('قراءة إشعارات البنك متوقفة'), findsNothing);
    expect(find.textContaining('لا يؤكد التطبيق أي دفع'), findsOneWidget);
  });

  testWidgets('a saved session opens behind the fingerprint, password is the fallback', (tester) async {
    final bio = FakeBiometric(succeed: false);
    final services = await buildServices(
      saved: TokenPair(accessToken: 'a-${Random().nextInt(99)}', refreshToken: 'r-${Random().nextInt(99)}'),
      biometric: bio,
    );
    await tester.pumpWidget(PatronAdminApp(services: services));
    await services.session.init();
    await tester.pumpAndSettle();

    expect(services.session.state, SessionState.locked);
    expect(find.text('التطبيق مقفل'), findsOneWidget);
    expect(bio.prompts, 1); // prompted automatically

    bio.succeed = true;
    await tester.tap(find.text('فتح'));
    await tester.pumpAndSettle();
    expect(services.session.state, SessionState.signedIn);

    // Lock again, then choose the password instead.
    services.session.didEnterBackground();
    await tester.pump();
    unawaited(services.session.didResume()); // within 5 min: stays open
    await tester.pumpAndSettle();
    expect(services.session.state, SessionState.signedIn);
  });

  testWidgets('password fallback forgets the saved session', (tester) async {
    final services = await buildServices(
      saved: TokenPair(accessToken: 'a-${Random().nextInt(99)}', refreshToken: 'r-${Random().nextInt(99)}'),
      biometric: FakeBiometric(succeed: false),
    );
    await tester.pumpWidget(PatronAdminApp(services: services));
    await services.session.init();
    await tester.pumpAndSettle();

    await tester.tap(find.text('الدخول بكلمة المرور بدلا من ذلك'));
    await tester.pumpAndSettle();
    expect(services.session.state, SessionState.signedOut);
    expect(await services.api.hasSession(), isFalse);
    expect(find.text('تسجيل دخول فريق المتجر'), findsOneWidget);
  });

  testWidgets('without biometrics a saved session opens directly', (tester) async {
    final services = await buildServices(
      saved: TokenPair(accessToken: 'a-${Random().nextInt(99)}', refreshToken: 'r-${Random().nextInt(99)}'),
      biometric: FakeBiometric(available: false),
    );
    await tester.pumpWidget(PatronAdminApp(services: services));
    await services.session.init();
    await tester.pumpAndSettle();
    expect(services.session.state, SessionState.signedIn);
    expect(find.text('ما يحتاج انتباهك'), findsOneWidget);
  });
}
