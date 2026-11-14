import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api/models.dart';

/// Where the session lives. The real one is the platform keystore; tests use
/// [MemoryTokenStore].
abstract class TokenStore {
  Future<TokenPair?> read();
  Future<void> write(TokenPair pair);
  Future<void> clear();
}

/// Android Keystore / iOS Keychain via flutter_secure_storage. Nothing about
/// the session is kept in plain shared preferences.
class SecureTokenStore implements TokenStore {
  SecureTokenStore([FlutterSecureStorage? storage]) : _storage = storage ?? const FlutterSecureStorage();

  static const _access = 'patron.accessToken';
  static const _refresh = 'patron.refreshToken';

  final FlutterSecureStorage _storage;
  TokenPair? _cache;

  @override
  Future<TokenPair?> read() async {
    if (_cache != null) return _cache;
    final access = await _storage.read(key: _access);
    final refresh = await _storage.read(key: _refresh);
    if (access == null || refresh == null) return null;
    return _cache = TokenPair(accessToken: access, refreshToken: refresh);
  }

  @override
  Future<void> write(TokenPair pair) async {
    _cache = pair;
    await _storage.write(key: _access, value: pair.accessToken);
    await _storage.write(key: _refresh, value: pair.refreshToken);
  }

  @override
  Future<void> clear() async {
    _cache = null;
    await _storage.delete(key: _access);
    await _storage.delete(key: _refresh);
  }
}

class MemoryTokenStore implements TokenStore {
  MemoryTokenStore([this._pair]);

  TokenPair? _pair;

  @override
  Future<TokenPair?> read() async => _pair;

  @override
  Future<void> write(TokenPair pair) async => _pair = pair;

  @override
  Future<void> clear() async => _pair = null;
}
