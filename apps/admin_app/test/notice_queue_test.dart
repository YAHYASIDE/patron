import 'package:flutter_test/flutter_test.dart';
import 'package:patron_admin/api/api_client.dart';
import 'package:patron_admin/api/models.dart';
import 'package:patron_admin/bank/notice_queue.dart';

/// A send function scripted per call.
class ScriptedSender {
  final List<Object> script = [];
  final List<String> calls = [];

  Future<BankNoticeReceipt> call(QueuedNotice n) async {
    calls.add(n.localId);
    final next = script.isEmpty ? _ok(n.localId) : script.removeAt(0);
    if (next is BankNoticeReceipt) return next;
    throw next;
  }

  static BankNoticeReceipt _ok(String id) =>
      BankNoticeReceipt(id: 'srv-$id', status: BankNoticeStatus.newNotice, confidence: 70);
}

QueuedNotice notice(String id, DateTime at) => QueuedNotice(
      localId: id,
      sourceApp: 'com.example.bank',
      title: 'Bank',
      text: 'Reçu 100 MRU',
      postedAt: at,
      capturedAt: at,
    );

void main() {
  late DateTime now;
  late MemoryQueueStore store;
  late ScriptedSender sender;
  late NoticeQueue queue;

  NoticeQueue build() => NoticeQueue(store: store, send: sender.call, clock: () => now);

  setUp(() {
    now = DateTime.utc(2026, 10, 20, 9);
    store = MemoryQueueStore();
    sender = ScriptedSender();
    queue = build();
  });

  group('RetryPolicy', () {
    test('doubles from 30 s and caps at 30 min', () {
      const p = RetryPolicy();
      expect(p.delayFor(1), const Duration(seconds: 30));
      expect(p.delayFor(2), const Duration(minutes: 1));
      expect(p.delayFor(3), const Duration(minutes: 2));
      expect(p.delayFor(7), const Duration(minutes: 30)); // 32 min capped
      expect(p.delayFor(50), const Duration(minutes: 30));
    });
  });

  test('adds once per local id and survives a restart', () async {
    expect(await queue.add(notice('a', now)), isTrue);
    expect(await queue.add(notice('a', now)), isFalse);
    expect(await queue.add(notice('b', now.add(const Duration(seconds: 1)))), isTrue);

    final reopened = build();
    await reopened.load();
    expect(reopened.items.map((i) => i.localId), ['b', 'a']); // newest first
    expect(reopened.pendingCount, 2);
  });

  test('sends oldest first and stores the server receipt', () async {
    await queue.add(notice('late', now.add(const Duration(minutes: 1))));
    await queue.add(notice('early', now));

    final report = await queue.flush();

    expect(report.sent, 2);
    expect(sender.calls, ['early', 'late']);
    final early = queue.items.firstWhere((i) => i.localId == 'early');
    expect(early.state, QueueState.sent);
    expect(early.receipt!.id, 'srv-early');
    expect(queue.pendingCount, 0);
  });

  test('network failure backs off and retries when due', () async {
    await queue.add(notice('a', now));
    sender.script.add(const ApiException(code: 'NETWORK'));

    var report = await queue.flush();
    expect(report.failed, 1);
    var item = queue.items.single;
    expect(item.state, QueueState.pending);
    expect(item.attempts, 1);
    expect(item.lastError, 'NETWORK');
    expect(item.nextAttemptAt, now.add(const Duration(seconds: 30)));

    // Not due yet: nothing is sent.
    now = now.add(const Duration(seconds: 10));
    report = await queue.flush();
    expect(sender.calls, ['a']);

    // A server error doubles the wait.
    now = now.add(const Duration(seconds: 25));
    sender.script.add(const ApiException(status: 503, code: 'HTTP_503'));
    await queue.flush();
    item = queue.items.single;
    expect(item.attempts, 2);
    expect(item.nextAttemptAt, now.add(const Duration(minutes: 1)));

    // Due again: it goes through.
    now = now.add(const Duration(minutes: 1));
    report = await queue.flush();
    expect(report.sent, 1);
    expect(queue.items.single.state, QueueState.sent);
    expect(sender.calls, ['a', 'a', 'a']);
  });

  test('a definitive 4xx is rejected and not retried automatically', () async {
    await queue.add(notice('a', now));
    sender.script.add(const ApiException(status: 400, code: 'APP_NOT_ALLOWED'));

    final report = await queue.flush();
    expect(report.rejected, 1);
    expect(queue.items.single.state, QueueState.rejected);
    expect(queue.items.single.lastError, 'APP_NOT_ALLOWED');

    now = now.add(const Duration(hours: 1));
    await queue.flush();
    expect(sender.calls, ['a']);

    // The owner presses "send now".
    await queue.retry('a');
    await queue.flush();
    expect(sender.calls, ['a', 'a']);
    expect(queue.items.single.state, QueueState.sent);
  });

  test('429 is transient', () async {
    await queue.add(notice('a', now));
    sender.script.add(const ApiException(status: 429, code: 'TOO_MANY'));
    await queue.flush();
    expect(queue.items.single.state, QueueState.pending);
  });

  test('a dead session stops the flush without counting an attempt', () async {
    await queue.add(notice('a', now));
    await queue.add(notice('b', now.add(const Duration(seconds: 1))));
    sender.script.add(const ApiException(status: 401, code: 'SESSION_EXPIRED'));

    final report = await queue.flush();
    expect(report.stoppedForAuth, isTrue);
    expect(sender.calls, ['a']);
    expect(queue.items.every((i) => i.state == QueueState.pending && i.attempts == 0), isTrue);
  });

  test('force sends items that are still backing off', () async {
    await queue.add(notice('a', now));
    sender.script.add(const ApiException(code: 'TIMEOUT'));
    await queue.flush();
    await queue.flush(force: true);
    expect(sender.calls, ['a', 'a']);
    expect(queue.items.single.state, QueueState.sent);
  });

  test('pending items are never pruned; old done items are', () async {
    final q = NoticeQueue(store: store, send: sender.call, clock: () => now, keepDone: 2);
    for (var i = 0; i < 4; i++) {
      await q.add(notice('s$i', now.add(Duration(seconds: i))));
    }
    await q.flush();
    sender.script.add(const ApiException(code: 'NETWORK'));
    await q.add(notice('p', now.add(const Duration(minutes: 5))));
    await q.flush();

    final ids = q.items.map((i) => i.localId).toSet();
    expect(ids, containsAll(['p', 's3', 's2']));
    expect(ids.length, 3);
  });

  test('server decisions are mirrored onto sent items', () async {
    await queue.add(notice('a', now));
    await queue.flush();
    await queue.applyServerStatuses({'srv-a': BankNoticeStatus.confirmed});
    expect(queue.items.single.receipt!.status, BankNoticeStatus.confirmed);

    final reopened = build();
    await reopened.load();
    expect(reopened.items.single.receipt!.status, BankNoticeStatus.confirmed);
  });

  test('a corrupt store loads as empty instead of crashing', () async {
    store.data = '{not json';
    await queue.load();
    expect(queue.items, isEmpty);
  });

  test('clearDone keeps pending items', () async {
    await queue.add(notice('a', now));
    await queue.flush();
    sender.script.add(const ApiException(code: 'NETWORK'));
    await queue.add(notice('b', now.add(const Duration(seconds: 1))));
    await queue.flush();
    await queue.clearDone();
    expect(queue.items.map((i) => i.localId), ['b']);
  });
}
