import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../auth/token_store.dart';
import 'models.dart';

/// A failed call. [status] is null when the server was never reached
/// (offline, DNS, timeout); [code] is the API's stable `error` code when it
/// sent one.
class ApiException implements Exception {
  const ApiException({this.status, required this.code, this.message = ''});

  final int? status;
  final String code;
  final String message;

  bool get isNetwork => status == null;
  bool get isUnauthorized => status == 401;
  bool get isForbidden => status == 403;

  /// Worth trying again later: offline, timeouts, rate limits, server errors.
  bool get isTransient =>
      status == null || status == 408 || status == 425 || status == 429 || (status! >= 500);

  @override
  String toString() => 'ApiException($status, $code)';
}

/// Talks to the Patron `/api/v1`. Adds the bearer token, refreshes it once on
/// a 401 (one refresh in flight at a time) and reports a dead session through
/// [onSessionExpired]. Tokens and passwords are never logged.
class ApiClient {
  ApiClient({
    required http.Client httpClient,
    required this._baseUrl,
    required this._tokens,
    this.timeout = const Duration(seconds: 45),
  }) : _http = httpClient;

  final http.Client _http;
  final String Function() _baseUrl;
  final TokenStore _tokens;

  /// Render's free plan sleeps; the first request after a nap can be slow.
  final Duration timeout;

  /// Called when the refresh token is rejected: the user must sign in again.
  void Function()? onSessionExpired;

  Future<TokenPair?>? _refreshing;

  // ─── Auth ───

  Future<TokenPair> login(String email, String password, {String? deviceInfo}) async {
    final json = await _send(
      'POST',
      '/auth/login',
      body: {
        'email': email.trim(),
        'password': password,
        'deviceInfo': ?deviceInfo,
      },
      auth: false,
    );
    final pair = TokenPair.fromJson(_asMap(json));
    await _tokens.write(pair);
    return pair;
  }

  Future<bool> hasSession() async => (await _tokens.read()) != null;

  Future<void> logout() => _tokens.clear();

  // ─── Staff endpoints ───

  Future<AttentionSummary> attention() async =>
      AttentionSummary.fromJson(_asMap(await _send('GET', '/admin/orders/attention')));

  Future<StaffNoticePage> staffNotifications({String state = 'open', int limit = 50}) async {
    final json = await _send('GET', '/admin/staff-notifications',
        query: {'state': state, 'limit': '$limit'});
    return StaffNoticePage.fromJson(_asMap(json));
  }

  Future<void> markNotificationRead(String id) async {
    await _send('POST', '/admin/staff-notifications/${Uri.encodeComponent(id)}/read');
  }

  Future<BankNoticeReceipt> uploadBankNotice(BankNoticeUpload upload) async =>
      BankNoticeReceipt.fromJson(_asMap(await _send('POST', '/admin/bank-notices', body: upload.toJson())));

  Future<List<BankNotice>> bankNotices({String? status}) async {
    final json = await _send('GET', '/admin/bank-notices',
        query: {if (status != null && status.isNotEmpty) 'status': status});
    final data = _asMap(json)['data'];
    return data is List
        ? data.whereType<Map>().map((m) => BankNotice.fromJson(m.cast<String, dynamic>())).toList()
        : const [];
  }

  Future<List<String>> bankNoticeAllowedApps() async {
    final apps = _asMap(await _send('GET', '/admin/bank-notices/config'))['allowedApps'];
    return apps is List ? apps.whereType<String>().where((a) => a.isNotEmpty).toList() : const [];
  }

  // ─── Plumbing ───

  Uri _uri(String path, Map<String, String>? query) {
    final base = _baseUrl().replaceAll(RegExp(r'/+$'), '');
    final uri = Uri.parse('$base$path');
    return query == null || query.isEmpty ? uri : uri.replace(queryParameters: query);
  }

  Future<Object?> _send(
    String method,
    String path, {
    Map<String, Object?>? body,
    Map<String, String>? query,
    bool auth = true,
    bool retried = false,
  }) async {
    final headers = <String, String>{'Accept': 'application/json'};
    if (body != null) headers['Content-Type'] = 'application/json';
    if (auth) {
      final pair = await _tokens.read();
      if (pair == null) {
        throw const ApiException(status: 401, code: 'NO_SESSION');
      }
      headers['Authorization'] = 'Bearer ${pair.accessToken}';
    }

    final request = http.Request(method, _uri(path, query))..headers.addAll(headers);
    if (body != null) request.body = jsonEncode(body);

    http.Response res;
    try {
      res = await http.Response.fromStream(await _http.send(request).timeout(timeout));
    } on TimeoutException {
      throw const ApiException(code: 'TIMEOUT');
    } on http.ClientException catch (e) {
      throw ApiException(code: 'NETWORK', message: e.message);
    } on Exception {
      throw const ApiException(code: 'NETWORK');
    }

    if (res.statusCode == 401 && auth && !retried) {
      final fresh = await _refreshOnce();
      if (fresh != null) {
        return _send(method, path, body: body, query: query, auth: auth, retried: true);
      }
      throw const ApiException(status: 401, code: 'SESSION_EXPIRED');
    }

    final decoded = _decode(res.body);
    if (res.statusCode >= 200 && res.statusCode < 300) return decoded;
    throw _errorFrom(res.statusCode, decoded);
  }

  /// One refresh for any number of concurrent 401s.
  Future<TokenPair?> _refreshOnce() {
    return _refreshing ??= _refresh().whenComplete(() => _refreshing = null);
  }

  Future<TokenPair?> _refresh() async {
    final current = await _tokens.read();
    if (current == null) return null;
    try {
      final json = await _send('POST', '/auth/refresh',
          body: {'refreshToken': current.refreshToken}, auth: false);
      final pair = TokenPair.fromJson(_asMap(json));
      await _tokens.write(pair);
      return pair;
    } on ApiException catch (e) {
      // Offline is not a dead session: keep the tokens and let the caller retry.
      if (e.isTransient) rethrow;
      await _tokens.clear();
      onSessionExpired?.call();
      return null;
    } on FormatException {
      await _tokens.clear();
      onSessionExpired?.call();
      return null;
    }
  }

  static Object? _decode(String body) {
    if (body.isEmpty) return null;
    try {
      return jsonDecode(body);
    } on FormatException {
      return null;
    }
  }

  static Map<String, dynamic> _asMap(Object? json) {
    if (json is Map) return json.cast<String, dynamic>();
    throw const ApiException(code: 'BAD_RESPONSE');
  }

  /// The API's envelope: `{ statusCode, error, message }` (message may be a list).
  static ApiException _errorFrom(int status, Object? body) {
    var code = 'HTTP_$status';
    var message = '';
    if (body is Map) {
      final c = body['code'] ?? body['error'];
      if (c is String && c.isNotEmpty) code = c;
      final m = body['message'];
      if (m is String) message = m;
      if (m is List) message = m.whereType<String>().join('\n');
    }
    return ApiException(status: status, code: code, message: message);
  }
}
