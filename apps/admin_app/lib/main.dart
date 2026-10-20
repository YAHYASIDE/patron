import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'api/api_client.dart';
import 'app.dart';
import 'auth/biometric.dart';
import 'auth/session.dart';
import 'auth/token_store.dart';
import 'bank/bank_sync.dart';
import 'bank/listener_channel.dart';
import 'bank/notice_queue.dart';
import 'settings.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final settings = await AppSettings.load();
  final api = ApiClient(
    httpClient: http.Client(),
    baseUrl: () => settings.apiUrl,
    tokens: SecureTokenStore(),
  );
  final session = SessionController(api: api, biometric: LocalAuthGate(), settings: settings);
  final bank = BankSync(
    platform: MethodChannelBankListener(),
    api: api,
    queue: NoticeQueue(
      store: PrefsQueueStore(),
      send: BankSync.senderFor(api, () => settings.deviceId),
    ),
    deviceId: () => settings.deviceId,
    canUpload: () => session.state == SessionState.signedIn,
  );

  runApp(PatronAdminApp(
    services: AppServices(settings: settings, api: api, session: session, bank: bank),
  ));
  await session.init();
}
