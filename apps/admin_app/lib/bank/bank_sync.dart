import 'dart:async';

import 'package:flutter/foundation.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import 'listener_channel.dart';
import 'notice_queue.dart';
import 'sensitive_filter.dart';

/// Moves bank notifications from the Android listener to the server:
/// listener store → filter again → local queue → POST /admin/bank-notices.
///
/// The phone only reports evidence. Nothing here (or on the server) confirms
/// a customer's payment; the owner reviews each notice in the dashboard.
class BankSync extends ChangeNotifier {
  BankSync({
    required this._platform,
    required this._api,
    required this._queue,
    required this._deviceId,
    required this._canUpload,
    this.tick = const Duration(minutes: 1),
  });

  final BankListenerPlatform _platform;
  final ApiClient _api;
  final NoticeQueue _queue;
  final String Function() _deviceId;
  final bool Function() _canUpload;
  final Duration tick;

  bool get supported => _platform.supported;
  NoticeQueue get queue => _queue;

  bool accessGranted = false;
  ListenerConfig config = const ListenerConfig(enabled: false, packages: {});
  List<String> allowedApps = const [];
  List<AppInfo> suggestions = const [];
  Map<String, AppInfo> appInfo = const {};
  int droppedCount = 0;

  /// Notices this app itself dropped as secrets (on top of the listener's count).
  int droppedHere = 0;

  StreamSubscription<void>? _eventSub;
  StreamSubscription<void>? _queueSub;
  Timer? _timer;
  bool _started = false;

  /// True once the saved queue is loaded; nothing is pulled or sent before,
  /// so an early call can never overwrite the stored queue.
  bool _ready = false;

  Future<void> start() async {
    if (_started) return sync(); // e.g. signed in again: send what waited.
    _started = true;
    await _queue.load();
    _ready = true;
    _queueSub = _queue.changes.listen((_) => notifyListeners());
    notifyListeners();
    if (!supported) return;
    await refreshState();
    _eventSub = _platform.events.listen((_) => unawaited(sync()));
    _timer = Timer.periodic(tick, (_) => unawaited(sync()));
    await sync();
  }

  /// Re-reads access, selection and suggestions (e.g. back from Android settings).
  Future<void> refreshState() async {
    if (!supported) return;
    try {
      accessGranted = await _platform.isAccessGranted();
      config = await _platform.getConfig();
      droppedCount = await _platform.droppedCount();
      suggestions = await _platform.suggestApps();
    } on Object catch (_) {
      // Native side unavailable (tests, old build): keep the last known state.
    }
    if (_canUpload()) {
      try {
        allowedApps = await _api.bankNoticeAllowedApps();
      } on ApiException {
        // Offline: the owner's own selection still works.
      }
    }
    await _describe();
    notifyListeners();
  }

  /// Every app the owner can choose from: their selection, the server's list
  /// and the phone's bank-looking apps. Nothing is selected automatically.
  List<String> get candidates {
    final all = <String>{
      ...config.packages,
      ...allowedApps,
      ...suggestions.map((s) => s.packageName),
    }.toList()
      ..sort();
    return all;
  }

  bool isServerAllowed(String pkg) => allowedApps.isEmpty || allowedApps.contains(pkg);

  Future<void> setEnabled(bool on) => _saveConfig(ListenerConfig(enabled: on, packages: config.packages));

  Future<void> setSelected(String pkg, bool selected) {
    final next = {...config.packages};
    selected ? next.add(pkg) : next.remove(pkg);
    return _saveConfig(ListenerConfig(enabled: config.enabled, packages: next));
  }

  /// A package typed by hand, validated as an Android package name.
  static bool isPackageName(String s) =>
      RegExp(r'^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$').hasMatch(s.trim());

  Future<void> openAccessSettings() => _platform.openAccessSettings();

  /// Pulls what the listener stored, then uploads what is due.
  Future<void> sync({bool force = false}) async {
    if (!_ready) return;
    await pull();
    if (_canUpload()) await _queue.flush(force: force);
  }

  /// Copies the listener's stored notices into the queue, then lets the
  /// listener forget them. The listener only forgets after the queue saved.
  Future<int> pull() async {
    if (!supported || !_ready) return 0;
    List<CapturedNotice> pending;
    try {
      // Fresh selection every time: an app the owner just unticked is not queued.
      config = await _platform.getConfig();
      pending = await _platform.fetchPending();
    } on Object catch (_) {
      return 0;
    }
    var added = 0;
    for (final n in pending) {
      if (!config.packages.contains(n.packageName)) continue;
      final f = SensitiveFilter.apply(title: n.title, text: n.text);
      if (f.dropped) {
        droppedHere++;
        continue;
      }
      final ok = await _queue.add(QueuedNotice(
        localId: n.id,
        sourceApp: n.packageName,
        title: f.title,
        text: f.text!,
        postedAt: n.postedAt,
        capturedAt: DateTime.now(),
      ));
      if (ok) added++;
    }
    if (pending.isNotEmpty) {
      try {
        await _platform.ack(pending.map((n) => n.id).toList());
      } on Object catch (_) {
        // Not acknowledged: they come back next time and the queue skips them by id.
      }
    }
    return added;
  }

  /// Sends one queued notice. Wired as the queue's sender.
  static NoticeSender senderFor(ApiClient api, String Function() deviceId) => (n) => api.uploadBankNotice(
        BankNoticeUpload(
          deviceId: deviceId(),
          sourceApp: n.sourceApp,
          title: n.title,
          text: n.text,
          postedAt: n.postedAt,
        ),
      );

  Future<void> retry(String localId) async {
    if (!_ready) return;
    await _queue.retry(localId);
    if (_canUpload()) await _queue.flush();
  }

  Future<void> _saveConfig(ListenerConfig next) async {
    config = next;
    notifyListeners();
    await _platform.setConfig(next);
  }

  Future<void> _describe() async {
    try {
      final infos = await _platform.describeApps(candidates);
      appInfo = {for (final i in [...suggestions, ...infos]) i.packageName: i};
    } on Object catch (_) {
      // Labels are cosmetic.
    }
  }

  String get deviceId => _deviceId();

  /// Stops the timer and listeners; [start] picks everything up again.
  void stop() {
    _timer?.cancel();
    _eventSub?.cancel();
    _queueSub?.cancel();
    _timer = null;
    _eventSub = null;
    _queueSub = null;
    _started = false;
  }

  @override
  void dispose() {
    stop();
    super.dispose();
  }
}
