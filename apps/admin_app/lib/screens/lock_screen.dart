import 'package:flutter/material.dart';

import '../app.dart';
import '../theme.dart';

/// A saved session behind the fingerprint. The password is the fallback:
/// choosing it forgets the saved session and shows the login.
class LockScreen extends StatefulWidget {
  const LockScreen({super.key});

  @override
  State<LockScreen> createState() => _LockScreenState();
}

class _LockScreenState extends State<LockScreen> {
  static const _reason = 'افتح تطبيق إدارة Patron';
  bool _busy = false;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _unlock());
  }

  Future<void> _unlock() async {
    if (_busy || !mounted) return;
    setState(() => _busy = true);
    final ok = await Services.of(context).session.unlock(_reason);
    if (mounted) {
      setState(() {
        _busy = false;
        _failed = !ok;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = Services.of(context).session;
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.fingerprint, size: 72, color: Brand.teal),
                const SizedBox(height: 16),
                Text('التطبيق مقفل', style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
                const SizedBox(height: 8),
                Text(
                  _failed ? 'لم يتم التحقق. حاول مجددا أو ادخل بكلمة المرور.' : 'استعمل البصمة أو قفل الهاتف للمتابعة.',
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 24),
                FilledButton.icon(
                  onPressed: _busy ? null : _unlock,
                  icon: const Icon(Icons.lock_open),
                  label: const Text('فتح'),
                  style: FilledButton.styleFrom(minimumSize: const Size(220, 52)),
                ),
                const SizedBox(height: 8),
                TextButton(
                  onPressed: _busy ? null : session.usePassword,
                  child: const Text('الدخول بكلمة المرور بدلا من ذلك'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
