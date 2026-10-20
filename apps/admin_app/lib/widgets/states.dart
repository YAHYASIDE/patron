import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../theme.dart';

/// Arabic text for a failed screen load.
String loadErrorText(Object e) {
  if (e is ApiException) {
    if (e.isNetwork) return 'تعذر الوصول إلى الخادم. قد يكون في وضع السكون، أعد المحاولة بعد لحظات.';
    if (e.isForbidden) return 'هذا الحساب لا يملك صلاحية هذه الصفحة.';
    if (e.isUnauthorized) return 'انتهت الجلسة، سجل الدخول مجددا.';
    if (e.status == 404) return 'هذه الخدمة غير متاحة بعد على الخادم.';
  }
  return 'تعذر التحميل. اسحب للتحديث.';
}

class LoadingBlock extends StatelessWidget {
  const LoadingBlock({super.key});

  @override
  Widget build(BuildContext context) =>
      const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()));
}

class ErrorBlock extends StatelessWidget {
  const ErrorBlock({super.key, required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              const Icon(Icons.cloud_off, color: Brand.bad),
              const SizedBox(width: 12),
              Expanded(child: Text(loadErrorText(error))),
              TextButton(onPressed: onRetry, child: const Text('إعادة')),
            ],
          ),
        ),
      );
}

class EmptyBlock extends StatelessWidget {
  const EmptyBlock({super.key, required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 24),
        child: Column(
          children: [
            Icon(icon, size: 40, color: Brand.ink500),
            const SizedBox(height: 8),
            Text(text, textAlign: TextAlign.center),
          ],
        ),
      );
}

class StatusChip extends StatelessWidget {
  const StatusChip({super.key, required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(99)),
        child: Text(label, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w700)),
      );
}
