import 'dart:convert';
import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:patron_admin/api/api_client.dart';
import 'package:patron_admin/api/models.dart';
import 'package:patron_admin/auth/token_store.dart';

/// Obviously fake, generated per run: never a real credential.
String fakeToken(String tag) => '$tag-${Random().nextInt(1 << 30)}';

http.Response json(Object body, [int status = 200]) =>
    http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json; charset=utf-8'});

const base = 'https://api.test/api/v1';

void main() {
  group('parsing', () {
    test('attention summary: orders and payment rows', () {
      final a = AttentionSummary.fromJson({
        'lateMinutes': 15,
        'total': 3,
        'failed': {
          'count': 1,
          'items': [
            {
              'id': 'o1',
              'orderNumber': 'PTN-20261020-000001',
              'status': 'FAILED',
              'total': '1500.0000',
              'currency': 'MRU',
              'user': {'fullName': 'Ahmed', 'phone': '+22200000000'},
              'minutes': 42,
              'error': 'provider timeout',
            },
          ],
        },
        'lateDelivery': {'count': 0, 'items': []},
        'waitingTransfers': {
          'count': 2,
          'items': [
            {
              'paymentId': 'p1',
              'amount': '300',
              'currency': 'MRU',
              'minutes': 20,
              'order': {'id': 'o2', 'orderNumber': 'PTN-2', 'user': {'fullName': null, 'phone': '+2221'}},
            },
          ],
        },
      });
      expect(a.total, 3);
      expect(a.failed.items.single.orderNumber, 'PTN-20261020-000001');
      expect(a.failed.items.single.amount, '1500.0000');
      expect(a.failed.items.single.customer, 'Ahmed');
      expect(a.failed.items.single.error, 'provider timeout');
      final t = a.waitingTransfers.items.single;
      expect(t.orderId, 'o2');
      expect(t.paymentId, 'p1');
      expect(t.amount, '300');
      expect(t.customer, '+2221');
      // A group the server left out reads as empty.
      expect(a.duplicatePayments.count, 0);
    });

    test('staff notifications with priorities', () {
      final page = StaffNoticePage.fromJson({
        'data': [
          {
            'id': 'n1',
            'type': 'order.failed',
            'priority': 'URGENT',
            'title': 'فشل التسليم',
            'body': 'الطلب PTN-1',
            'link': '/orders/o1',
            'createdAt': '2026-10-20T08:00:00.000Z',
            'readAt': null,
            'resolvedAt': null,
            'remindCount': 2,
          },
          {'id': 'n2', 'priority': 'weird', 'title': 't', 'body': '', 'readAt': '2026-10-20T08:05:00.000Z'},
        ],
        'unread': 1,
        'open': 2,
      });
      expect(page.data.first.priority, StaffPriority.urgent);
      expect(page.data.first.unread, isTrue);
      expect(page.data.first.remindCount, 2);
      expect(page.data.first.link, '/orders/o1');
      expect(page.data.last.priority, StaffPriority.normal);
      expect(page.data.last.unread, isFalse);
      expect(page.unread, 1);
      expect(page.open, 2);
    });

    test('bank notice receipt and list item', () {
      final r = BankNoticeReceipt.fromJson({
        'id': 'b1',
        'status': 'SUGGESTED',
        'duplicate': false,
        'amount': '1500.0000',
        'currency': 'MRU',
        'reference': 'TX1',
        'confidence': 140,
      });
      expect(r.status, BankNoticeStatus.suggested);
      expect(r.confidence, 100); // clamped
      final n = BankNotice.fromJson({
        'id': 'b2',
        'status': 'DUPLICATE',
        'sourceApp': 'com.example.bank',
        'text': 'Reçu',
        'postedAt': '2026-10-20T08:00:00.000Z',
        'order': {'id': 'o9', 'orderNumber': 'PTN-9'},
      });
      expect(n.status, BankNoticeStatus.duplicate);
      expect(n.orderId, 'o9');
      expect(n.orderNumber, 'PTN-9');
      expect(n.confidence, 0);
    });

    test('upload body is ISO UTC and omits an empty title', () {
      final body = BankNoticeUpload(
        deviceId: 'android-x',
        sourceApp: 'com.example.bank',
        title: '',
        text: 'Reçu 100 MRU',
        postedAt: DateTime.utc(2026, 10, 20, 8, 30),
      ).toJson();
      expect(body, {
        'deviceId': 'android-x',
        'sourceApp': 'com.example.bank',
        'text': 'Reçu 100 MRU',
        'postedAt': '2026-10-20T08:30:00.000Z',
      });
    });
  });

  group('ApiClient', () {
    late MemoryTokenStore tokens;
    late List<http.Request> requests;

    ApiClient client(MockClientHandler handler) =>
        ApiClient(httpClient: MockClient(handler), baseUrl: () => '$base/', tokens: tokens);

    setUp(() {
      tokens = MemoryTokenStore();
      requests = [];
    });

    test('login stores the token pair and sends no bearer', () async {
      final access = fakeToken('access');
      final refresh = fakeToken('refresh');
      final api = client((req) async {
        requests.add(req);
        return json({'accessToken': access, 'refreshToken': refresh, 'expiresIn': 900});
      });

      await api.login(' owner@shop.test ', 'pw-${Random().nextInt(999)}');

      expect(requests.single.url.toString(), '$base/auth/login');
      expect(requests.single.headers.containsKey('Authorization'), isFalse);
      expect(jsonDecode(requests.single.body)['email'], 'owner@shop.test');
      expect((await tokens.read())!.accessToken, access);
    });

    test('maps the error envelope', () async {
      final api = client((req) async => json({'statusCode': 401, 'error': 'INVALID_CREDENTIALS', 'message': 'nope'}, 401));
      await expectLater(
        api.login('a@b.test', 'x'),
        throwsA(isA<ApiException>()
            .having((e) => e.status, 'status', 401)
            .having((e) => e.code, 'code', 'INVALID_CREDENTIALS')),
      );
      expect(await tokens.read(), isNull);
    });

    test('a validation message list is joined', () async {
      final api = client((req) async => json({'statusCode': 400, 'error': 'Bad Request', 'message': ['a', 'b']}, 400));
      await expectLater(api.login('a@b.test', 'x'),
          throwsA(isA<ApiException>().having((e) => e.message, 'message', 'a\nb')));
    });

    test('sends the bearer and query, parses notifications', () async {
      final access = fakeToken('access');
      await tokens.write(TokenPair(accessToken: access, refreshToken: fakeToken('refresh')));
      final api = client((req) async {
        requests.add(req);
        return json({'data': [], 'unread': 0, 'open': 0});
      });

      await api.staffNotifications();

      final req = requests.single;
      expect(req.url.path, '/api/v1/admin/staff-notifications');
      expect(req.url.queryParameters, {'state': 'open', 'limit': '50'});
      expect(req.headers['Authorization'], 'Bearer $access');
    });

    test('refreshes once on 401, retries, and keeps the new pair', () async {
      final oldAccess = fakeToken('old');
      final newAccess = fakeToken('new');
      final newRefresh = fakeToken('newr');
      await tokens.write(TokenPair(accessToken: oldAccess, refreshToken: fakeToken('r')));
      var refreshCalls = 0;
      final api = client((req) async {
        requests.add(req);
        if (req.url.path.endsWith('/auth/refresh')) {
          refreshCalls++;
          return json({'accessToken': newAccess, 'refreshToken': newRefresh});
        }
        if (req.headers['Authorization'] == 'Bearer $oldAccess') return json({'statusCode': 401}, 401);
        return json({'allowedApps': ['com.example.bank', '', 3]});
      });

      // Two calls at once share one refresh.
      final results = await Future.wait([api.bankNoticeAllowedApps(), api.bankNoticeAllowedApps()]);

      expect(results.first, ['com.example.bank']);
      expect(refreshCalls, 1);
      expect((await tokens.read())!.accessToken, newAccess);
      expect((await tokens.read())!.refreshToken, newRefresh);
    });

    test('a rejected refresh clears the session and reports it', () async {
      await tokens.write(TokenPair(accessToken: fakeToken('a'), refreshToken: fakeToken('r')));
      var expired = 0;
      final api = client((req) async => json({'statusCode': 401, 'error': 'Unauthorized'}, 401))
        ..onSessionExpired = () => expired++;

      await expectLater(api.attention(), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'SESSION_EXPIRED')));
      expect(expired, 1);
      expect(await tokens.read(), isNull);
    });

    test('offline during refresh keeps the session', () async {
      await tokens.write(TokenPair(accessToken: fakeToken('a'), refreshToken: fakeToken('r')));
      final api = client((req) async {
        if (req.url.path.endsWith('/auth/refresh')) throw http.ClientException('offline');
        return json({'statusCode': 401}, 401);
      });

      await expectLater(api.attention(), throwsA(isA<ApiException>().having((e) => e.isNetwork, 'isNetwork', true)));
      expect(await tokens.read(), isNotNull);
    });

    test('upload posts the notice and parses the 201 receipt', () async {
      await tokens.write(TokenPair(accessToken: fakeToken('a'), refreshToken: fakeToken('r')));
      final api = client((req) async {
        requests.add(req);
        return json({
          'id': 'b1',
          'status': 'NEW',
          'duplicate': true,
          'amount': null,
          'currency': null,
          'reference': null,
          'confidence': 10,
        }, 201);
      });

      final r = await api.uploadBankNotice(BankNoticeUpload(
        deviceId: 'android-x',
        sourceApp: 'com.example.bank',
        text: 'Reçu',
        postedAt: DateTime.utc(2026),
      ));

      expect(requests.single.method, 'POST');
      expect(requests.single.url.path, '/api/v1/admin/bank-notices');
      expect(requests.single.headers['Content-Type'], startsWith('application/json'));
      expect(r.duplicate, isTrue);
      expect(r.status, BankNoticeStatus.newNotice);
    });

    test('bank notices list passes the status filter', () async {
      await tokens.write(TokenPair(accessToken: fakeToken('a'), refreshToken: fakeToken('r')));
      final api = client((req) async {
        requests.add(req);
        return json({
          'data': [
            {'id': 'b1', 'status': 'NEW', 'sourceApp': 'x', 'text': 't', 'confidence': 55},
          ],
        });
      });

      final list = await api.bankNotices(status: 'NEW');
      expect(requests.single.url.queryParameters, {'status': 'NEW'});
      expect(list.single.confidence, 55);
    });

    test('no session means no request', () async {
      final api = client((req) async => fail('should not be called'));
      await expectLater(api.attention(), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'NO_SESSION')));
    });
  });
}
