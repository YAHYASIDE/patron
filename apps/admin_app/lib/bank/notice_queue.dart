import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:shared_preferences/shared_preferences.dart';

import '../api/api_client.dart';
import '../api/models.dart';

/// Where a queued notice stands on this phone.
enum QueueState {
  /// Waiting to be sent (first try or a retry after a failure).
  pending,

  /// The server stored it; [QueuedNotice.receipt] holds its answer.
  sent,

  /// The server refused it for good (e.g. the app is not allowed); not retried.
  rejected,
}

/// One bank notification, already masked, waiting for or done with upload.
class QueuedNotice {
  QueuedNotice({
    required this.localId,
    required this.sourceApp,
    this.title,
    required this.text,
    required this.postedAt,
    required this.capturedAt,
    this.state = QueueState.pending,
    this.attempts = 0,
    this.nextAttemptAt,
    this.lastError,
    this.receipt,
  });

  factory QueuedNotice.fromJson(Map<String, dynamic> json) => QueuedNotice(
        localId: json['localId'] as String,
        sourceApp: json['sourceApp'] as String,
        title: json['title'] as String?,
        text: json['text'] as String,
        postedAt: DateTime.parse(json['postedAt'] as String),
        capturedAt: DateTime.parse(json['capturedAt'] as String),
        state: QueueState.values.firstWhere((s) => s.name == json['state'], orElse: () => QueueState.pending),
        attempts: (json['attempts'] as num?)?.toInt() ?? 0,
        nextAttemptAt: json['nextAttemptAt'] == null ? null : DateTime.parse(json['nextAttemptAt'] as String),
        lastError: json['lastError'] as String?,
        receipt: json['receipt'] is Map
            ? BankNoticeReceipt.fromJson((json['receipt'] as Map).cast<String, dynamic>())
            : null,
      );

  final String localId;
  final String sourceApp;
  final String? title;
  final String text;
  final DateTime postedAt;
  final DateTime capturedAt;
  QueueState state;
  int attempts;
  DateTime? nextAttemptAt;
  String? lastError;
  BankNoticeReceipt? receipt;

  Map<String, dynamic> toJson() => {
        'localId': localId,
        'sourceApp': sourceApp,
        'title': title,
        'text': text,
        'postedAt': postedAt.toUtc().toIso8601String(),
        'capturedAt': capturedAt.toUtc().toIso8601String(),
        'state': state.name,
        'attempts': attempts,
        'nextAttemptAt': nextAttemptAt?.toUtc().toIso8601String(),
        'lastError': lastError,
        'receipt': receipt?.toJson(),
      };
}

/// Exponential backoff: 30 s, 1 min, 2 min … capped at 30 min, with up to
/// 20 % jitter so several phones do not retry in lockstep.
class RetryPolicy {
  const RetryPolicy({
    this.base = const Duration(seconds: 30),
    this.max = const Duration(minutes: 30),
    this.jitter = 0.2,
  });

  final Duration base;
  final Duration max;
  final double jitter;

  /// Delay before the next try after [attempts] failed tries (1-based).
  Duration delayFor(int attempts, [Random? random]) {
    final exp = min(attempts - 1, 20);
    final raw = base.inMilliseconds * pow(2, exp);
    final capped = min(raw.toDouble(), max.inMilliseconds.toDouble());
    final spread = random == null ? 0.0 : capped * jitter * random.nextDouble();
    return Duration(milliseconds: (capped + spread).round());
  }
}

/// Persistence for the queue (shared preferences on the phone, memory in tests).
abstract class QueueStore {
  Future<String?> read();
  Future<void> write(String data);
}

class PrefsQueueStore implements QueueStore {
  static const _key = 'bank.queue.v1';

  @override
  Future<String?> read() async => (await SharedPreferences.getInstance()).getString(_key);

  @override
  Future<void> write(String data) async => (await SharedPreferences.getInstance()).setString(_key, data);
}

class MemoryQueueStore implements QueueStore {
  String? data;

  @override
  Future<String?> read() async => data;

  @override
  Future<void> write(String value) async => data = value;
}

class FlushReport {
  const FlushReport({this.sent = 0, this.failed = 0, this.rejected = 0, this.stoppedForAuth = false});

  final int sent;
  final int failed;
  final int rejected;

  /// The session is gone: nothing is penalised, the queue waits for a login.
  final bool stoppedForAuth;
}

typedef NoticeSender = Future<BankNoticeReceipt> Function(QueuedNotice notice);

/// The local upload queue. It survives restarts (every change is saved),
/// sends oldest first, backs off on failures and never drops an unsent item
/// to make room.
class NoticeQueue {
  NoticeQueue({
    required this._store,
    required this._send,
    DateTime Function()? clock,
    this.policy = const RetryPolicy(),
    this._random,
    this.keepDone = 200,
  }) : _clock = clock ?? DateTime.now;

  final QueueStore _store;
  final NoticeSender _send;
  final DateTime Function() _clock;
  final Random? _random;
  final RetryPolicy policy;

  /// How many sent/rejected items stay visible for the owner.
  final int keepDone;

  final List<QueuedNotice> _items = [];
  bool _flushing = false;
  final _changes = StreamController<void>.broadcast();

  /// Newest first, for display.
  List<QueuedNotice> get items =>
      List.unmodifiable(List.of(_items)..sort((a, b) => b.capturedAt.compareTo(a.capturedAt)));

  int get pendingCount => _items.where((i) => i.state == QueueState.pending).length;

  Stream<void> get changes => _changes.stream;

  Future<void> load() async {
    final raw = await _store.read();
    _items.clear();
    if (raw == null || raw.isEmpty) return;
    try {
      final list = jsonDecode(raw);
      if (list is List) {
        for (final e in list.whereType<Map>()) {
          try {
            _items.add(QueuedNotice.fromJson(e.cast<String, dynamic>()));
          } on Object {
            // A corrupt entry is skipped, the rest of the queue survives.
          }
        }
      }
    } on FormatException {
      // Unreadable store: start empty rather than crash at launch.
    }
  }

  /// Adds a notice unless one with the same [QueuedNotice.localId] exists.
  Future<bool> add(QueuedNotice notice) async {
    if (_items.any((i) => i.localId == notice.localId)) return false;
    _items.add(notice);
    _prune();
    await _save();
    return true;
  }

  /// When the next pending item becomes due, or null when nothing waits.
  DateTime? get nextDue {
    DateTime? best;
    for (final i in _items.where((i) => i.state == QueueState.pending)) {
      final at = i.nextAttemptAt ?? i.capturedAt;
      if (best == null || at.isBefore(best)) best = at;
    }
    return best;
  }

  /// Sends every due item, oldest first. Safe to call often: a second call
  /// while one runs returns at once.
  Future<FlushReport> flush({bool force = false}) async {
    if (_flushing) return const FlushReport();
    _flushing = true;
    var sent = 0, failed = 0, rejected = 0;
    try {
      final now = _clock();
      final due = _items
          .where((i) =>
              i.state == QueueState.pending && (force || i.nextAttemptAt == null || !i.nextAttemptAt!.isAfter(now)))
          .toList()
        ..sort((a, b) => a.postedAt.compareTo(b.postedAt));

      for (final item in due) {
        try {
          item.receipt = await _send(item);
          item.state = QueueState.sent;
          item.lastError = null;
          item.nextAttemptAt = null;
          sent++;
        } on ApiException catch (e) {
          if (e.isUnauthorized) {
            await _save();
            return FlushReport(sent: sent, failed: failed, rejected: rejected, stoppedForAuth: true);
          }
          item.attempts++;
          item.lastError = e.code;
          if (e.isTransient) {
            item.nextAttemptAt = _clock().add(policy.delayFor(item.attempts, _random));
            failed++;
          } else {
            item.state = QueueState.rejected;
            item.nextAttemptAt = null;
            rejected++;
          }
        } on Object catch (_) {
          item.attempts++;
          item.lastError = 'UNKNOWN';
          item.nextAttemptAt = _clock().add(policy.delayFor(item.attempts, _random));
          failed++;
        }
        await _save();
      }
      _prune();
      if (due.isNotEmpty) await _save();
      return FlushReport(sent: sent, failed: failed, rejected: rejected);
    } finally {
      _flushing = false;
    }
  }

  /// "Try now" from the screen: a pending or rejected item goes back to the front.
  Future<void> retry(String localId) async {
    for (final i in _items.where((i) => i.localId == localId && i.state != QueueState.sent)) {
      i.state = QueueState.pending;
      i.nextAttemptAt = null;
    }
    await _save();
  }

  /// Mirrors the dashboard's later decisions (confirmed, ignored…) onto sent items.
  Future<void> applyServerStatuses(Map<String, BankNoticeStatus> byServerId) async {
    var changed = false;
    for (final i in _items) {
      final r = i.receipt;
      if (r == null) continue;
      final s = byServerId[r.id];
      if (s != null && s != r.status) {
        i.receipt = r.withStatus(s);
        changed = true;
      }
    }
    if (changed) await _save();
  }

  /// Removes everything already sent or rejected; pending items stay.
  Future<void> clearDone() async {
    _items.removeWhere((i) => i.state != QueueState.pending);
    await _save();
  }

  void _prune() {
    final done = _items.where((i) => i.state != QueueState.pending).toList()
      ..sort((a, b) => a.capturedAt.compareTo(b.capturedAt));
    final excess = done.length - keepDone;
    if (excess > 0) {
      final drop = done.take(excess).toSet();
      _items.removeWhere(drop.contains);
    }
  }

  Future<void> _save() async {
    await _store.write(jsonEncode(_items.map((i) => i.toJson()).toList()));
    _changes.add(null);
  }

  Future<void> dispose() => _changes.close();
}
