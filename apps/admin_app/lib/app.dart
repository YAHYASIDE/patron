import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:url_launcher/url_launcher.dart';

import 'api/api_client.dart';
import 'auth/session.dart';
import 'bank/bank_sync.dart';
import 'screens/lock_screen.dart';
import 'screens/login_screen.dart';
import 'screens/shell.dart';
import 'settings.dart';
import 'theme.dart';

/// Everything the screens need, built once in main() (or by a test).
class AppServices {
  AppServices({
    required this.settings,
    required this.api,
    required this.session,
    required this.bank,
    Future<bool> Function(Uri uri)? openUrl,
  }) : openUrl = openUrl ?? _launch;

  final AppSettings settings;
  final ApiClient api;
  final SessionController session;
  final BankSync bank;

  /// Opens a dashboard page in the browser.
  final Future<bool> Function(Uri uri) openUrl;

  static Future<bool> _launch(Uri uri) => launchUrl(uri, mode: LaunchMode.externalApplication);
}

class Services extends InheritedWidget {
  const Services({super.key, required this.services, required super.child});

  final AppServices services;

  static AppServices of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<Services>()!.services;

  @override
  bool updateShouldNotify(Services oldWidget) => services != oldWidget.services;
}

class PatronAdminApp extends StatefulWidget {
  const PatronAdminApp({super.key, required this.services});

  final AppServices services;

  @override
  State<PatronAdminApp> createState() => _PatronAdminAppState();
}

class _PatronAdminAppState extends State<PatronAdminApp> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final s = widget.services;
    if (state == AppLifecycleState.paused) s.session.didEnterBackground();
    if (state == AppLifecycleState.resumed) {
      s.session.didResume();
      // Back from Android's notification-access screen, or a while away.
      s.bank.refreshState();
      if (s.session.state == SessionState.signedIn) s.bank.sync();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Services(
      services: widget.services,
      child: MaterialApp(
        title: 'Patron الإدارة',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(Brightness.light),
        darkTheme: buildTheme(Brightness.dark),
        // Arabic first; the layout is right-to-left.
        locale: const Locale('ar'),
        supportedLocales: const [Locale('ar'), Locale('en'), Locale('fr')],
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        home: ListenableBuilder(
          listenable: widget.services.session,
          builder: (context, _) => switch (widget.services.session.state) {
            SessionState.loading => const _Splash(),
            SessionState.signedOut => const LoginScreen(),
            SessionState.locked => const LockScreen(),
            SessionState.signedIn => const Shell(),
          },
        ),
      ),
    );
  }
}

class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) => const Scaffold(body: Center(child: CircularProgressIndicator()));
}
