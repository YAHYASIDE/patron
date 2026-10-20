import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// A notification the Android listener kept (already filtered and masked
/// natively). [id] is stable for the same notification, so a repeat read is
/// recognised by the queue.
class CapturedNotice {
  const CapturedNotice({
    required this.id,
    required this.packageName,
    this.title,
    required this.text,
    required this.postedAt,
  });

  factory CapturedNotice.fromMap(Map<Object?, Object?> m) => CapturedNotice(
        id: '${m['id']}',
        packageName: '${m['package']}',
        title: m['title'] as String?,
        text: (m['text'] as String?) ?? '',
        postedAt: DateTime.fromMillisecondsSinceEpoch((m['postedAt'] as num?)?.toInt() ?? 0),
      );

  final String id;
  final String packageName;
  final String? title;
  final String text;
  final DateTime postedAt;
}

class ListenerConfig {
  const ListenerConfig({required this.enabled, required this.packages});

  final bool enabled;
  final Set<String> packages;
}

class AppInfo {
  const AppInfo({required this.packageName, this.label, required this.installed});

  final String packageName;
  final String? label;
  final bool installed;
}

/// The bridge to BankNotificationListener.kt. Only Android implements it;
/// everywhere else [supported] is false and the feature is hidden.
abstract class BankListenerPlatform {
  bool get supported;
  Future<bool> isAccessGranted();
  Future<void> openAccessSettings();
  Future<ListenerConfig> getConfig();
  Future<void> setConfig(ListenerConfig config);
  Future<List<CapturedNotice>> fetchPending();
  Future<void> ack(List<String> ids);
  Future<int> droppedCount();
  Future<List<AppInfo>> describeApps(List<String> packages);

  /// Installed apps whose name looks like a bank or wallet. Only a suggestion:
  /// nothing is read from an app until the owner ticks it.
  Future<List<AppInfo>> suggestApps();

  /// Fires when the listener stored something new (app in memory only).
  Stream<void> get events;
}

class MethodChannelBankListener implements BankListenerPlatform {
  static const _methods = MethodChannel('patron/bank_listener');
  static const _events = EventChannel('patron/bank_listener/events');

  Stream<void>? _stream;

  @override
  bool get supported => !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  @override
  Future<bool> isAccessGranted() async =>
      supported && (await _methods.invokeMethod<bool>('isAccessGranted') ?? false);

  @override
  Future<void> openAccessSettings() => _methods.invokeMethod<void>('openAccessSettings');

  @override
  Future<ListenerConfig> getConfig() async {
    if (!supported) return const ListenerConfig(enabled: false, packages: {});
    final m = await _methods.invokeMapMethod<String, Object?>('getConfig') ?? const {};
    return ListenerConfig(
      enabled: m['enabled'] == true,
      packages: ((m['packages'] as List?) ?? const []).whereType<String>().toSet(),
    );
  }

  @override
  Future<void> setConfig(ListenerConfig config) => _methods.invokeMethod<void>('setConfig', {
        'enabled': config.enabled,
        'packages': config.packages.toList(),
      });

  @override
  Future<List<CapturedNotice>> fetchPending() async {
    if (!supported) return const [];
    final list = await _methods.invokeListMethod<Map<Object?, Object?>>('fetchPending') ?? const [];
    return list.map(CapturedNotice.fromMap).toList();
  }

  @override
  Future<void> ack(List<String> ids) => _methods.invokeMethod<void>('ack', {'ids': ids});

  @override
  Future<int> droppedCount() async =>
      supported ? (await _methods.invokeMethod<int>('droppedCount') ?? 0) : 0;

  @override
  Future<List<AppInfo>> describeApps(List<String> packages) async {
    if (!supported || packages.isEmpty) return const [];
    final list = await _methods
            .invokeListMethod<Map<Object?, Object?>>('describeApps', {'packages': packages}) ??
        const [];
    return list.map(_appInfo).toList();
  }

  @override
  Future<List<AppInfo>> suggestApps() async {
    if (!supported) return const [];
    final list = await _methods.invokeListMethod<Map<Object?, Object?>>('suggestApps') ?? const [];
    return list.map(_appInfo).toList();
  }

  static AppInfo _appInfo(Map<Object?, Object?> m) => AppInfo(
        packageName: '${m['package']}',
        label: m['label'] as String?,
        installed: m['installed'] == true,
      );

  @override
  Stream<void> get events => _stream ??= supported
      ? _events.receiveBroadcastStream().map((_) {})
      : const Stream<void>.empty();
}
