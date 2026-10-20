import 'package:flutter/foundation.dart';

import '../api/api_client.dart';
import '../settings.dart';
import 'biometric.dart';

enum SessionState { loading, signedOut, locked, signedIn }

/// Who is using the app right now.
///
/// - A fresh install shows the login (staff email + password).
/// - A saved session reopens behind the fingerprint when the lock is on and
///   the phone supports it; "use the password" drops the saved session.
/// - Coming back after [relockAfter] in the background locks again.
class SessionController extends ChangeNotifier {
  SessionController({
    required this._api,
    required this._biometric,
    required this._settings,
    DateTime Function()? clock,
    this.relockAfter = const Duration(minutes: 5),
  }) : _clock = clock ?? DateTime.now {
    _api.onSessionExpired = _expired;
  }

  final ApiClient _api;
  final BiometricGate _biometric;
  final AppSettings _settings;
  final DateTime Function() _clock;
  final Duration relockAfter;

  SessionState _state = SessionState.loading;
  SessionState get state => _state;

  /// Set when the server ended the session, to explain the login screen.
  bool expired = false;

  DateTime? _backgroundSince;

  Future<void> init() async {
    if (!await _api.hasSession()) return _set(SessionState.signedOut);
    _set(await _lockAvailable() ? SessionState.locked : SessionState.signedIn);
  }

  Future<void> login(String email, String password) async {
    await _api.login(email, password, deviceInfo: 'Patron admin app');
    expired = false;
    _set(SessionState.signedIn);
  }

  /// Returns false when the check was cancelled or failed.
  Future<bool> unlock(String reason) async {
    final ok = await _biometric.authenticate(reason);
    if (ok) _set(SessionState.signedIn);
    return ok;
  }

  /// The fallback from the lock screen: forget the saved session and sign in again.
  Future<void> usePassword() => logout();

  Future<void> logout() async {
    await _api.logout();
    _set(SessionState.signedOut);
  }

  Future<bool> biometricAvailable() => _biometric.isAvailable();

  void didEnterBackground() => _backgroundSince = _clock();

  Future<void> didResume() async {
    final since = _backgroundSince;
    _backgroundSince = null;
    if (_state != SessionState.signedIn || since == null) return;
    if (_clock().difference(since) >= relockAfter && await _lockAvailable()) {
      _set(SessionState.locked);
    }
  }

  Future<bool> _lockAvailable() async => _settings.biometricLock && await _biometric.isAvailable();

  void _expired() {
    expired = true;
    _set(SessionState.signedOut);
  }

  void _set(SessionState s) {
    if (_state == s) return;
    _state = s;
    notifyListeners();
  }
}

/// Arabic text for an API failure on the login screen.
String loginErrorText(Object e) {
  if (e is ApiException) {
    if (e.isNetwork) return 'تعذر الوصول إلى الخادم. تحقق من الاتصال وحاول مجددا.';
    if (e.status == 401) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
    if (e.status == 403) return 'الحساب موقوف أو تجاوز عدد المحاولات. حاول لاحقا.';
    if (e.status == 429) return 'محاولات كثيرة. انتظر دقيقة ثم حاول مجددا.';
    if (e.status == 400) return 'تحقق من البريد الإلكتروني وكلمة المرور.';
  }
  return 'حدث خطأ غير متوقع. حاول مجددا.';
}
