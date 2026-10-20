import 'package:flutter/material.dart';

import '../app.dart';
import 'bank_notices_screen.dart';
import 'home_screen.dart';
import 'settings_screen.dart';

/// Signed-in frame: home, bank notices, settings.
class Shell extends StatefulWidget {
  const Shell({super.key});

  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> {
  int _index = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final bank = Services.of(context).bank;
      // Uploads anything the listener collected while we were signed out.
      bank.start().then((_) => bank.sync());
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _index,
        children: const [HomeScreen(), BankNoticesScreen(), SettingsScreen()],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.dashboard_outlined), selectedIcon: Icon(Icons.dashboard), label: 'الرئيسية'),
          NavigationDestination(
              icon: Icon(Icons.account_balance_outlined), selectedIcon: Icon(Icons.account_balance), label: 'إشعارات البنك'),
          NavigationDestination(icon: Icon(Icons.settings_outlined), selectedIcon: Icon(Icons.settings), label: 'الإعدادات'),
        ],
      ),
    );
  }
}
