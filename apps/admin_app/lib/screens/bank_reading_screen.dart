import 'package:flutter/material.dart';

import '../app.dart';
import '../bank/bank_sync.dart';
import '../bank/notice_queue.dart';
import '../theme.dart';
import '../widgets/states.dart';

/// Android only. Explains the feature, sends the owner to Android's own
/// notification-access screen (the app never grants itself access), lets the
/// owner pick the bank apps, and shows the local upload queue.
class BankReadingScreen extends StatefulWidget {
  const BankReadingScreen({super.key});

  @override
  State<BankReadingScreen> createState() => _BankReadingScreenState();
}

class _BankReadingScreenState extends State<BankReadingScreen> {
  final _manual = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => Services.of(context).bank.refreshState());
  }

  @override
  void dispose() {
    _manual.dispose();
    super.dispose();
  }

  Future<void> _addManual(BankSync bank) async {
    final pkg = _manual.text.trim();
    if (!BankSync.isPackageName(pkg)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('اسم الحزمة غير صالح، مثال: com.bank.app')),
      );
      return;
    }
    await bank.setSelected(pkg, true);
    _manual.clear();
    await bank.refreshState();
  }

  @override
  Widget build(BuildContext context) {
    final bank = Services.of(context).bank;
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('قراءة إشعارات البنك')),
      body: ListenableBuilder(
        listenable: bank,
        builder: (context, _) {
          final candidates = bank.candidates;
          final queue = bank.queue.items;
          return RefreshIndicator(
            onRefresh: () async {
              await bank.refreshState();
              await bank.sync(force: true);
            },
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                Text(
                  'عند تفعيلها، يقرأ التطبيق إشعارات تطبيقات البنك التي تختارها أنت فقط، '
                  'ويرسلها إلى لوحة التحكم كأدلة تساعدك على مطابقة التحويلات مع الطلبات.',
                  style: theme.textTheme.bodyMedium,
                ),
                const SizedBox(height: 12),
                const _PrivacyList(),
                const SizedBox(height: 16),

                // Step 1 — Android permission, granted by the owner only.
                _Step(
                  number: 1,
                  title: 'إذن الوصول إلى الإشعارات',
                  done: bank.accessGranted,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(bank.accessGranted
                          ? 'الإذن ممنوح. يمكنك سحبه في أي وقت من إعدادات أندرويد.'
                          : 'افتح إعدادات أندرويد، ثم فعل "Patron الإدارة" في قائمة الوصول إلى الإشعارات.'),
                      const SizedBox(height: 8),
                      OutlinedButton.icon(
                        onPressed: bank.openAccessSettings,
                        icon: const Icon(Icons.open_in_new),
                        label: Text(bank.accessGranted ? 'إدارة الإذن' : 'فتح إعدادات الإذن'),
                      ),
                    ],
                  ),
                ),

                // Step 2 — which apps.
                _Step(
                  number: 2,
                  title: 'اختر تطبيقات البنك',
                  done: bank.config.packages.isNotEmpty,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Text('لا يقرأ التطبيق شيئا من تطبيق لم تضع عليه علامة. الاقتراحات لا تُختار تلقائيا.'),
                      if (candidates.isEmpty)
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 8),
                          child: Text('لا اقتراحات. أضف اسم حزمة التطبيق يدويا.'),
                        ),
                      for (final pkg in candidates)
                        CheckboxListTile(
                          contentPadding: EdgeInsets.zero,
                          value: bank.config.packages.contains(pkg),
                          onChanged: (v) => bank.setSelected(pkg, v ?? false),
                          title: Text(bank.appInfo[pkg]?.label ?? pkg),
                          subtitle: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(pkg, textDirection: TextDirection.ltr, style: theme.textTheme.bodySmall),
                              if (bank.allowedApps.contains(pkg))
                                const Text('ضمن قائمة الخادم', style: TextStyle(color: Brand.ok, fontSize: 12))
                              else if (!bank.isServerAllowed(pkg))
                                const Text('ليس في قائمة الخادم: قد يرفض الخادم إشعاراته',
                                    style: TextStyle(color: Brand.warn, fontSize: 12)),
                            ],
                          ),
                        ),
                      Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: _manual,
                              textDirection: TextDirection.ltr,
                              decoration: const InputDecoration(
                                isDense: true,
                                labelText: 'اسم حزمة يدويا',
                                hintText: 'com.bank.app',
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          IconButton.filledTonal(
                            tooltip: 'إضافة',
                            onPressed: () => _addManual(bank),
                            icon: const Icon(Icons.add),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),

                // Step 3 — on/off (off by default).
                _Step(
                  number: 3,
                  title: 'التشغيل',
                  done: bank.config.enabled,
                  child: SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('قراءة إشعارات البنك'),
                    subtitle: Text(!bank.accessGranted
                        ? 'يعمل بعد منح الإذن في الخطوة 1.'
                        : bank.config.packages.isEmpty
                            ? 'اختر تطبيقا واحدا على الأقل.'
                            : 'الجهاز: ${bank.deviceId}'),
                    value: bank.config.enabled,
                    onChanged: bank.setEnabled,
                  ),
                ),

                const SizedBox(height: 8),
                Row(
                  children: [
                    Text('قائمة الإرسال على الهاتف',
                        style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                    const Spacer(),
                    if (queue.any((q) => q.state != QueueState.pending))
                      TextButton(onPressed: bank.queue.clearDone, child: const Text('مسح المرسل')),
                  ],
                ),
                if (bank.droppedCount + bank.droppedHere > 0)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text(
                      'حُجب ${bank.droppedCount + bank.droppedHere} إشعار يشبه رمز تحقق أو كلمة سر، ولم يُرسل.',
                      style: theme.textTheme.bodySmall,
                    ),
                  ),
                if (queue.isEmpty) const EmptyBlock(icon: Icons.outbox_outlined, text: 'لا شيء في القائمة.'),
                for (final q in queue) ...[
                  _QueueTile(item: q, onRetry: () => bank.retry(q.localId)),
                  const SizedBox(height: 8),
                ],
              ],
            ),
          );
        },
      ),
    );
  }
}

class _PrivacyList extends StatelessWidget {
  const _PrivacyList();

  @override
  Widget build(BuildContext context) {
    const points = [
      'متوقفة افتراضيا، ولا تعمل إلا بعد أن تمنح الإذن بنفسك من إعدادات أندرويد.',
      'تُقرأ فقط إشعارات التطبيقات التي تختارها، ويُتجاهل كل ما عداها.',
      'كل إشعار يشبه رمز تحقق (OTP) أو رمزا سريا أو كلمة سر يُحذف على الهاتف ولا يُرسل.',
      'أرقام البطاقات تُخفى ولا يظهر منها إلا آخر 4 أرقام.',
      'التطبيق لا يؤكد أي دفع أبدا: الإشعار دليل يراجعه المالك في لوحة التحكم.',
    ];
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final p in points)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.shield_outlined, size: 18, color: Brand.teal),
                    const SizedBox(width: 8),
                    Expanded(child: Text(p)),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _Step extends StatelessWidget {
  const _Step({required this.number, required this.title, required this.done, required this.child});

  final int number;
  final String title;
  final bool done;
  final Widget child;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    CircleAvatar(
                      radius: 13,
                      backgroundColor: done ? Brand.ok : Brand.ink500,
                      child: done
                          ? const Icon(Icons.check, size: 16, color: Colors.white)
                          : Text('$number', style: const TextStyle(color: Colors.white, fontSize: 13)),
                    ),
                    const SizedBox(width: 10),
                    Text(title, style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800)),
                  ],
                ),
                const SizedBox(height: 8),
                child,
              ],
            ),
          ),
        ),
      );
}

class _QueueTile extends StatelessWidget {
  const _QueueTile({required this.item, required this.onRetry});

  final QueuedNotice item;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final r = item.receipt;
    final (String label, Color color) = switch (item.state) {
      QueueState.pending => (item.attempts == 0 ? 'بانتظار الإرسال' : 'إعادة المحاولة', Brand.gold),
      QueueState.rejected => ('رفضه الخادم', Brand.bad),
      QueueState.sent => r == null
          ? ('أُرسل', Brand.ok)
          : (r.duplicate ? 'مكرر' : bankStatusLabel(r.status), r.duplicate ? Brand.warn : bankStatusColor(r.status)),
    };
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(item.title ?? item.sourceApp,
                      maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700)),
                ),
                StatusChip(label: label, color: color),
              ],
            ),
            const SizedBox(height: 4),
            Text(item.text, maxLines: 3, overflow: TextOverflow.ellipsis),
            const SizedBox(height: 4),
            Text(
              [
                item.sourceApp,
                formatDateTime(item.postedAt),
                if (r != null && r.amount != null) formatMoney(r.amount, r.currency),
                if (r != null) 'الثقة ${r.confidence}%',
                if (item.state != QueueState.sent && item.lastError != null) item.lastError!,
                if (item.state == QueueState.pending && item.nextAttemptAt != null)
                  'المحاولة التالية ${formatDateTime(item.nextAttemptAt)}',
              ].join(' · '),
              style: Theme.of(context).textTheme.bodySmall,
            ),
            if (item.state != QueueState.sent)
              Align(
                alignment: AlignmentDirectional.centerEnd,
                child: TextButton(onPressed: onRetry, child: const Text('أرسل الآن')),
              ),
          ],
        ),
      ),
    );
  }
}
