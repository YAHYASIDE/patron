import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Non-secret app preferences. Tokens never live here (see SecureTokenStore).
class AppSettings extends ChangeNotifier {
  AppSettings(this._prefs);

  /// Build-time defaults; override with
  /// `flutter build apk --dart-define=PATRON_API_URL=https://…/api/v1`.
  static const defaultApiUrl = String.fromEnvironment(
    'PATRON_API_URL',
    defaultValue: 'https://etssadagha-api.onrender.com/api/v1',
  );
  static const defaultDashboardUrl = String.fromEnvironment(
    'PATRON_DASHBOARD_URL',
    defaultValue: 'https://etssadagha-shop.onrender.com',
  );

  static const _kApi = 'settings.apiUrl';
  static const _kDashboard = 'settings.dashboardUrl';
  static const _kBiometric = 'settings.biometricLock';
  static const _kDevice = 'settings.deviceId';
  static const _kRelock = 'settings.relockMinutes';
  static const _kHome = 'cache.home';

  /// How long the app may stay in the background before the fingerprint is
  /// asked again. The owner picks one in the settings screen.
  static const relockChoices = [5, 30, 120];
  static const defaultRelockMinutes = 30;

  final SharedPreferences _prefs;

  static Future<AppSettings> load() async => AppSettings(await SharedPreferences.getInstance());

  String get apiUrl => _prefs.getString(_kApi) ?? defaultApiUrl;
  String get dashboardUrl => _prefs.getString(_kDashboard) ?? defaultDashboardUrl;
  bool get biometricLock => _prefs.getBool(_kBiometric) ?? true;

  /// A random id for this phone, so the dashboard can tell devices apart.
  /// Not derived from any hardware identifier.
  String get deviceId {
    final existing = _prefs.getString(_kDevice);
    if (existing != null) return existing;
    final rnd = Random.secure();
    final id = 'android-${List.generate(12, (_) => rnd.nextInt(256).toRadixString(16).padLeft(2, '0')).join()}';
    _prefs.setString(_kDevice, id);
    return id;
  }

  int get relockMinutes {
    final m = _prefs.getInt(_kRelock);
    return relockChoices.contains(m) ? m! : defaultRelockMinutes;
  }

  Future<void> setRelockMinutes(int minutes) async {
    if (!relockChoices.contains(minutes)) return;
    await _prefs.setInt(_kRelock, minutes);
    notifyListeners();
  }

  /// The last home screen the server sent ({attention, notices, savedAt}), so the
  /// app opens on it at once while the fresh one loads. It holds order numbers
  /// and notice titles, never tokens; it lives in the app's private storage and
  /// is deleted on sign-out.
  HomeSnapshot? get homeSnapshot {
    final raw = _prefs.getString(_kHome);
    if (raw == null) return null;
    try {
      final j = jsonDecode(raw) as Map<String, dynamic>;
      return HomeSnapshot(
        attention: (j['attention'] as Map).cast<String, dynamic>(),
        notices: (j['notices'] as Map).cast<String, dynamic>(),
        savedAt: DateTime.parse(j['savedAt'] as String),
      );
    } on Object {
      return null;
    }
  }

  Future<void> saveHomeSnapshot(HomeSnapshot s) => _prefs.setString(
        _kHome,
        jsonEncode({'attention': s.attention, 'notices': s.notices, 'savedAt': s.savedAt.toIso8601String()}),
      );

  Future<void> clearHomeSnapshot() => _prefs.remove(_kHome);

  Future<void> setApiUrl(String url) => _setUrl(_kApi, url, defaultApiUrl);
  Future<void> setDashboardUrl(String url) => _setUrl(_kDashboard, url, defaultDashboardUrl);

  Future<void> setBiometricLock(bool on) async {
    await _prefs.setBool(_kBiometric, on);
    notifyListeners();
  }

  Future<void> _setUrl(String key, String url, String fallback) async {
    final clean = url.trim().replaceAll(RegExp(r'/+$'), '');
    if (clean.isEmpty || clean == fallback) {
      await _prefs.remove(key);
    } else {
      await _prefs.setString(key, clean);
    }
    notifyListeners();
  }

  /// Only https (or http to a local machine while developing) is accepted.
  static bool isValidUrl(String url) {
    final u = Uri.tryParse(url.trim());
    if (u == null || !u.hasAuthority) return false;
    if (u.scheme == 'https') return true;
    return u.scheme == 'http' && (u.host == 'localhost' || u.host == '10.0.2.2' || u.host == '127.0.0.1');
  }

  /// Absolute dashboard URL for an API `link` such as `/orders/<id>`.
  Uri dashboardLink(String? link) {
    final base = dashboardUrl.replaceAll(RegExp(r'/+$'), '');
    if (link == null || link.isEmpty) return Uri.parse(base);
    final parsed = Uri.tryParse(link);
    // Only links into our own dashboard: an absolute URL elsewhere is ignored.
    if (parsed != null && parsed.hasScheme) {
      final home = Uri.parse(base);
      return parsed.host == home.host ? parsed : home;
    }
    return Uri.parse('$base${link.startsWith('/') ? link : '/$link'}');
  }
}

class HomeSnapshot {
  const HomeSnapshot({required this.attention, required this.notices, required this.savedAt});

  final Map<String, dynamic> attention;
  final Map<String, dynamic> notices;
  final DateTime savedAt;
}
