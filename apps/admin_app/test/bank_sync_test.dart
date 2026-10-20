import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:patron_admin/api/api_client.dart';
import 'package:patron_admin/api/models.dart';
import 'package:patron_admin/auth/token_store.dart';
import 'package:patron_admin/bank/bank_sync.dart';
import 'package:patron_admin/bank/listener_channel.dart';
import 'package:patron_admin/bank/notice_queue.dart';

/// Stands in for BankNotificationListener.kt + BankListenerStore.kt.
class FakeListener implements BankListenerPlatform {
  FakeListener({required this.packages});

  Set<String> packages;
  bool enabled = true;
  final List<CapturedNotice> stored = [];
  final List<String> acked = [];
  final events$ = StreamController<void>.broadcast();

  @override
  bool get supported => true;
  @override
  Future<bool> isAccessGranted() async => true;
  @override
  Future<void> openAccessSettings() async {}
  @override
  Future<ListenerConfig> getConfig() async => ListenerConfig(enabled: enabled, packages: packages);
  @override
  Future<void> setConfig(ListenerConfig config) async {
    enabled = config.enabled;
    packages = config.packages;
  }

  @override
  Future<List<CapturedNotice>> fetchPending() async => List.of(stored);
  @override
  Future<void> ack(List<String> ids) async {
    acked.addAll(ids);
    stored.removeWhere((n) => ids.contains(n.id));
  }

  @override
  Future<int> droppedCount() async => 0;
  @override
  Future<List<AppInfo>> describeApps(List<String> packages) async => const [];
  @override
  Future<List<AppInfo>> suggestApps() async => const [];
  @override
  Stream<void> get events => events$.stream;
}

CapturedNotice captured(String id, String pkg, String text) =>
    CapturedNotice(id: id, packageName: pkg, title: 'Bank', text: text, postedAt: DateTime.utc(2026, 10, 20, 8));

void main() {
  const bankPkg = 'com.example.bank';
  late FakeListener listener;
  late MemoryQueueStore store;
  late List<Map<String, dynamic>> uploads;
  late bool signedIn;
  late BankSync sync;

  setUp(() async {
    listener = FakeListener(packages: {bankPkg});
    store = MemoryQueueStore();
    uploads = [];
    signedIn = true;
    final api = ApiClient(
      httpClient: MockClient((req) async {
        if (req.url.path.endsWith('/admin/bank-notices/config')) {
          return http.Response(jsonEncode({'allowedApps': [bankPkg]}), 200);
        }
        uploads.add(jsonDecode(req.body) as Map<String, dynamic>);
        return http.Response(
          jsonEncode({'id': 'srv-${uploads.length}', 'status': 'NEW', 'duplicate': false, 'confidence': 80}),
          201,
        );
      }),
      baseUrl: () => 'https://api.test/api/v1',
      tokens: MemoryTokenStore(const TokenPair(accessToken: 'test-access', refreshToken: 'test-refresh')),
    );
    sync = BankSync(
      platform: listener,
      api: api,
      queue: NoticeQueue(store: store, send: BankSync.senderFor(api, () => 'android-test')),
      deviceId: () => 'android-test',
      canUpload: () => signedIn,
      tick: const Duration(hours: 1),
    );
  });

  tearDown(() => sync.dispose());

  test('nothing is pulled before the saved queue is loaded', () async {
    listener.stored.add(captured('n1', bankPkg, 'Reçu 100 MRU'));
    await sync.sync();
    expect(listener.acked, isEmpty);
    expect(uploads, isEmpty);
  });

  test('queues, uploads and acknowledges a selected app\'s notice', () async {
    listener.stored.add(captured('n1', bankPkg, 'Reçu 1500 MRU, réf TX1'));
    await sync.start();

    expect(uploads, hasLength(1));
    expect(uploads.single['sourceApp'], bankPkg);
    expect(uploads.single['deviceId'], 'android-test');
    expect(uploads.single['text'], 'Reçu 1500 MRU, réf TX1');
    expect(listener.acked, ['n1']);
    expect(sync.queue.items.single.state, QueueState.sent);
    expect(sync.queue.items.single.receipt!.status, BankNoticeStatus.newNotice);
    expect(sync.allowedApps, [bankPkg]);
  });

  test('unselected apps and secrets never reach the queue or the server', () async {
    listener.stored
      ..add(captured('n1', 'com.other.app', 'Reçu 100 MRU'))
      ..add(captured('n2', bankPkg, 'Votre code de vérification est 4412'))
      ..add(captured('n3', bankPkg, 'Débit carte 4111 1111 1111 1234: 50 MRU'));
    await sync.start();

    expect(uploads, hasLength(1));
    expect(uploads.single['text'], 'Débit carte •••• 1234: 50 MRU');
    expect(sync.droppedHere, 1);
    // Everything fetched is acknowledged, so dropped items are gone from the phone too.
    expect(listener.acked, unorderedEquals(['n1', 'n2', 'n3']));
  });

  test('signed out: notices wait in the queue and go out after sign-in', () async {
    signedIn = false;
    listener.stored.add(captured('n1', bankPkg, 'Reçu 100 MRU'));
    await sync.start();
    expect(uploads, isEmpty);
    expect(sync.queue.pendingCount, 1);
    expect(store.data, contains('Reçu 100 MRU')); // persisted

    signedIn = true;
    await sync.start(); // the shell starts it again after login
    expect(uploads, hasLength(1));
    expect(sync.queue.pendingCount, 0);
  });

  test('a listener event triggers a pull', () async {
    await sync.start();
    listener.stored.add(captured('n9', bankPkg, 'Reçu 200 MRU'));
    listener.events$.add(null);
    await pumpEventQueue();
    expect(uploads.map((u) => u['text']), ['Reçu 200 MRU']);
  });

  test('the owner\'s choices go to the listener', () async {
    await sync.start();
    await sync.setSelected('com.second.bank', true);
    await sync.setEnabled(false);
    expect(listener.packages, {bankPkg, 'com.second.bank'});
    expect(listener.enabled, isFalse);
    expect(BankSync.isPackageName('com.bank.app'), isTrue);
    expect(BankSync.isPackageName('not a package'), isFalse);
  });
}
