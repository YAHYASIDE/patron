// Opening the app fast: the server is woken early, the home screen opens on the
// phone's last copy, a slow (sleeping) server is explained, and the lock delay
// is the owner's choice.
import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:patron_admin/api/api_client.dart';
import 'package:patron_admin/api/models.dart';
import 'package:patron_admin/app.dart';
import 'package:patron_admin/auth/session.dart';
import 'package:patron_admin/auth/token_store.dart';
import 'package:patron_admin/bank/bank_sync.dart';
import 'package:patron_admin/bank/notice_queue.dart';
import 'package:patron_admin/screens/home_screen.dart';
import 'package:patron_admin/screens/settings_screen.dart';
import 'package:patron_admin/settings.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'widget_test.dart' show FakeBiometric, NoListener, fakeApi;

TokenPair _saved() => TokenPair(accessToken: 'a-${Random().nextInt(99)}', refreshToken: 'r-${Random().nextInt(99)}');

Map<String, dynamic> _attention(int failed) => {
      'total': failed,
      'failed': {'count': failed, 'items': []},
      'lateDelivery': {'count': 0, 'items': []},
      'waitingTransfers': {'count': 0, 'items': []},
      'duplicatePayments': {'count': 0, 'items': []},
    };

const _notices = {'data': [], 'unread': 0, 'open': 0};

Future<AppServices> _services({
  required Future<http.Response> Function(http.Request) handler,
  Map<String, Object> prefs = const {},
  DateTime Function()? clock,
}) async {
  SharedPreferences.setMockInitialValues(prefs);
  final settings = AppSettings(await SharedPreferences.getInstance());
  final api = ApiClient(httpClient: MockClient(handler), baseUrl: () => 'https://api.test/api/v1', tokens: MemoryTokenStore(_saved()));
  final session = SessionController(api: api, biometric: FakeBiometric(available: false), settings: settings, clock: clock);
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
  test('wake() calls the health check without a token and never throws', () async {
    final seen = <String>[];
    final api = ApiClient(
      httpClient: MockClient((req) async {
        seen.add('${req.url.path} auth=${req.headers.containsKey('Authorization')}');
        throw http.ClientException('asleep');
      }),
      baseUrl: () => 'https://api.test/api/v1',
      tokens: MemoryTokenStore(_saved()),
    );
    await api.wake();
    expect(seen, ['/api/v1/health/live auth=false']);
  });

  testWidgets('home opens at once on the saved copy, then shows the fresh one and saves it', (tester) async {
    final server = Completer<void>();
    final services = await _services(
      handler: (req) async {
        await server.future; // the server is asleep until we say so
        return fakeApi(req);
      },
      prefs: {
        'cache.home': jsonEncode({
          'attention': _attention(7),
          'notices': _notices,
          'savedAt': DateTime.now().subtract(const Duration(minutes: 12)).toIso8601String(),
        }),
      },
    );
    await tester.pumpWidget(PatronAdminApp(services: services));
    await services.session.init();
    await tester.pump();
    await tester.pump();

    // The phone's copy is on screen while the server sleeps.
    expect(find.text('فشل التسليم (7)'), findsOneWidget);
    expect(find.textContaining('آخر تحديث قبل 12 دقيقة'), findsOneWidget);
    expect(find.textContaining('جار التحديث'), findsOneWidget);

    server.complete();
    await tester.pumpAndSettle();
    expect(find.text('فشل التسليم (2)'), findsOneWidget); // fresh from fakeApi
    expect(find.textContaining('آخر تحديث'), findsNothing);
    expect(services.settings.homeSnapshot?.attention['total'], 3);
  });

  testWidgets('a long first load explains that the server is waking up', (tester) async {
    final server = Completer<void>();
    final services = await _services(handler: (req) async {
      await server.future;
      return fakeApi(req);
    });
    await tester.pumpWidget(PatronAdminApp(services: services));
    await services.session.init();
    await tester.pump();
    await tester.pump();
    expect(find.textContaining('الخادم يستيقظ'), findsNothing);

    await tester.pump(HomeScreenSlow.after + const Duration(seconds: 1));
    expect(find.textContaining('الخادم يستيقظ'), findsOneWidget);

    server.complete();
    await tester.pumpAndSettle();
    expect(find.textContaining('الخادم يستيقظ'), findsNothing);
    expect(find.text('فشل التسليم (2)'), findsOneWidget);
  });

  test('signing out deletes the saved home copy', () async {
    final services = await _services(handler: fakeApi, prefs: {
      'cache.home': jsonEncode({'attention': _attention(1), 'notices': _notices, 'savedAt': DateTime.now().toIso8601String()}),
    });
    expect(services.settings.homeSnapshot, isNotNull);
    await services.session.logout();
    expect(services.settings.homeSnapshot, isNull);
  });

  test("the lock comes back after the owner's chosen time (30 minutes by default)", () async {
    var now = DateTime(2026, 1, 1, 9);
    SharedPreferences.setMockInitialValues({});
    final settings = AppSettings(await SharedPreferences.getInstance());
    final session = SessionController(
      api: ApiClient(httpClient: MockClient(fakeApi), baseUrl: () => 'https://api.test/api/v1', tokens: MemoryTokenStore(_saved())),
      biometric: FakeBiometric(),
      settings: settings,
      clock: () => now,
    );
    await session.init();
    expect(session.state, SessionState.locked);
    await session.unlock('test');
    expect(settings.relockMinutes, 30);

    session.didEnterBackground();
    now = now.add(const Duration(minutes: 20));
    await session.didResume();
    expect(session.state, SessionState.signedIn); // 20 min < 30

    await settings.setRelockMinutes(5);
    session.didEnterBackground();
    now = now.add(const Duration(minutes: 6));
    await session.didResume();
    expect(session.state, SessionState.locked);

    await settings.setRelockMinutes(7); // not a choice: ignored
    expect(settings.relockMinutes, 5);
  });

  test('saved-ago wording', () {
    final now = DateTime(2026, 1, 1, 12);
    expect(savedAgo(now.subtract(const Duration(seconds: 20)), now), 'الآن');
    expect(savedAgo(now.subtract(const Duration(minutes: 5)), now), 'قبل 5 دقيقة');
    expect(savedAgo(now.subtract(const Duration(hours: 3)), now), 'قبل 3 ساعة');
    expect(savedAgo(now.subtract(const Duration(days: 2)), now), 'قبل 2 يوم');
    expect(relockLabel(120), 'ساعتين');
  });
}
