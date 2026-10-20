import 'package:flutter/material.dart';

import '../app.dart';
import '../settings.dart';
import 'bank_reading_screen.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool? _biometricAvailable;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final ok = await Services.of(context).session.biometricAvailable();
      if (mounted) setState(() => _biometricAvailable = ok);
    });
  }

  Future<void> _confirmLogout() async {
    final s = Services.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('تسجيل الخروج؟'),
        content: const Text('ستحتاج إلى البريد وكلمة المرور للدخول مجددا. الإشعارات غير المرسلة تبقى في القائمة.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('إلغاء')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('خروج')),
        ],
      ),
    );
    if (ok == true) await s.session.logout();
  }

  @override
  Widget build(BuildContext context) {
    final s = Services.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('الإعدادات')),
      body: ListenableBuilder(
        listenable: s.settings,
        builder: (context, _) => ListView(
          children: [
            const _Header('الأمان'),
            SwitchListTile(
              secondary: const Icon(Icons.fingerprint),
              title: const Text('قفل التطبيق بالبصمة'),
              subtitle: Text(_biometricAvailable == false
                  ? 'هذا الهاتف لا يدعم البصمة أو قفل الشاشة.'
                  : 'يطلب البصمة عند فتح التطبيق وبعد 5 دقائق في الخلفية.'),
              value: s.settings.biometricLock && _biometricAvailable != false,
              onChanged: _biometricAvailable == false ? null : s.settings.setBiometricLock,
            ),
            ListTile(
              leading: const Icon(Icons.logout),
              title: const Text('تسجيل الخروج'),
              onTap: _confirmLogout,
            ),
            if (s.bank.supported) ...[
              const _Header('إشعارات البنك'),
              ListTile(
                leading: const Icon(Icons.account_balance_outlined),
                title: const Text('قراءة إشعارات البنك (اختياري)'),
                subtitle: const Text('الإذن، التطبيقات المختارة، قائمة الإرسال'),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: (_) => const BankReadingScreen()),
                ),
              ),
            ],
            const _Header('الخادم'),
            ListTile(
              leading: const Icon(Icons.dns_outlined),
              title: const Text('عناوين الخادم ولوحة التحكم'),
              subtitle: Text(s.settings.apiUrl, textDirection: TextDirection.ltr),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => const ServerSettingsScreen()),
              ),
            ),
            ListTile(
              leading: const Icon(Icons.open_in_browser),
              title: const Text('فتح لوحة التحكم'),
              onTap: () => s.openUrl(s.settings.dashboardLink('/')),
            ),
          ],
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsetsDirectional.fromSTEB(16, 20, 16, 4),
        child: Text(text,
            style: Theme.of(context).textTheme.labelLarge?.copyWith(color: Theme.of(context).colorScheme.primary)),
      );
}

/// API and dashboard addresses. Reachable from the login screen too, so a
/// self-hosted shop can point the app at its own server before signing in.
class ServerSettingsScreen extends StatefulWidget {
  const ServerSettingsScreen({super.key});

  @override
  State<ServerSettingsScreen> createState() => _ServerSettingsScreenState();
}

class _ServerSettingsScreenState extends State<ServerSettingsScreen> {
  final _form = GlobalKey<FormState>();
  late final TextEditingController _api;
  late final TextEditingController _dashboard;
  bool _init = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_init) return;
    _init = true;
    final settings = Services.of(context).settings;
    _api = TextEditingController(text: settings.apiUrl);
    _dashboard = TextEditingController(text: settings.dashboardUrl);
  }

  @override
  void dispose() {
    _api.dispose();
    _dashboard.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    final settings = Services.of(context).settings;
    await settings.setApiUrl(_api.text);
    await settings.setDashboardUrl(_dashboard.text);
    if (mounted) Navigator.of(context).pop();
  }

  void _reset() {
    _api.text = AppSettings.defaultApiUrl;
    _dashboard.text = AppSettings.defaultDashboardUrl;
  }

  String? _validate(String? v) => AppSettings.isValidUrl(v ?? '') ? null : 'عنوان https صالح مطلوب';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('الخادم')),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextFormField(
              controller: _api,
              textDirection: TextDirection.ltr,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(labelText: 'عنوان واجهة API', helperText: 'ينتهي عادة بـ /api/v1'),
              validator: _validate,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _dashboard,
              textDirection: TextDirection.ltr,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(labelText: 'عنوان لوحة التحكم'),
              validator: _validate,
            ),
            const SizedBox(height: 24),
            FilledButton(onPressed: _save, child: const Text('حفظ')),
            TextButton(onPressed: _reset, child: const Text('العناوين الافتراضية')),
          ],
        ),
      ),
    );
  }
}
