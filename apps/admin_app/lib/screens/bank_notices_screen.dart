import 'package:flutter/material.dart';

import '../api/models.dart';
import '../app.dart';
import '../theme.dart';
import '../widgets/states.dart';
import 'bank_reading_screen.dart';

/// Bank notices as the server parsed them. Evidence for review only: the
/// owner confirms payments in the dashboard, never from here.
class BankNoticesScreen extends StatefulWidget {
  const BankNoticesScreen({super.key});

  @override
  State<BankNoticesScreen> createState() => _BankNoticesScreenState();
}

class _BankNoticesScreenState extends State<BankNoticesScreen> {
  static const _filters = [
    null,
    BankNoticeStatus.newNotice,
    BankNoticeStatus.suggested,
    BankNoticeStatus.confirmed,
    BankNoticeStatus.ignored,
    BankNoticeStatus.duplicate,
  ];

  BankNoticeStatus? _filter;
  List<BankNotice>? _items;
  Object? _error;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final s = Services.of(context);
    setState(() => _loading = true);
    try {
      final items = await s.api.bankNotices(status: _filter == null ? null : bankStatusToApi(_filter!));
      if (!mounted) return;
      setState(() {
        _items = items;
        _error = null;
      });
      await s.bank.queue.applyServerStatuses({for (final n in items) n.id: n.status});
    } on Object catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _open(BankNotice n) {
    final s = Services.of(context);
    s.openUrl(s.settings.dashboardLink(n.orderId != null ? '/orders/${n.orderId}' : '/bank-notices'));
  }

  @override
  Widget build(BuildContext context) {
    final bank = Services.of(context).bank;
    final items = _items;
    return Scaffold(
      appBar: AppBar(
        title: const Text('إشعارات البنك'),
        actions: [IconButton(tooltip: 'تحديث', onPressed: _loading ? null : _load, icon: const Icon(Icons.refresh))],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          if (bank.supported) await bank.sync(force: true);
          await _load();
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            if (bank.supported) const _ReadingCard(),
            const SizedBox(height: 8),
            const _EvidenceNote(),
            const SizedBox(height: 8),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (final f in _filters)
                    Padding(
                      padding: const EdgeInsetsDirectional.only(end: 6),
                      child: ChoiceChip(
                        label: Text(f == null ? 'الكل' : bankStatusLabel(f)),
                        selected: _filter == f,
                        onSelected: (_) {
                          setState(() => _filter = f);
                          _load();
                        },
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            if (_loading && items == null) const LoadingBlock(),
            if (_error != null) ErrorBlock(error: _error!, onRetry: _load),
            if (items != null && items.isEmpty)
              const EmptyBlock(icon: Icons.inbox_outlined, text: 'لا إشعارات بنكية هنا.'),
            if (items != null)
              for (final n in items) ...[
                BankNoticeCard(notice: n, onTap: () => _open(n)),
                const SizedBox(height: 8),
              ],
          ],
        ),
      ),
    );
  }
}

class _EvidenceNote extends StatelessWidget {
  const _EvidenceNote();

  @override
  Widget build(BuildContext context) => Row(
        children: [
          const Icon(Icons.info_outline, size: 18, color: Brand.ink500),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              'هذه أدلة للمراجعة فقط. لا يؤكد التطبيق أي دفع؛ راجع الطلب وأكده من لوحة التحكم.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
        ],
      );
}

class _ReadingCard extends StatelessWidget {
  const _ReadingCard();

  @override
  Widget build(BuildContext context) {
    final bank = Services.of(context).bank;
    return ListenableBuilder(
      listenable: bank,
      builder: (context, _) {
        final on = bank.config.enabled && bank.accessGranted && bank.config.packages.isNotEmpty;
        final pending = bank.queue.pendingCount;
        return Card(
          child: ListTile(
            leading: Icon(on ? Icons.notifications_active : Icons.notifications_off_outlined,
                color: on ? Brand.ok : Brand.ink500),
            title: Text(on ? 'قراءة إشعارات البنك تعمل' : 'قراءة إشعارات البنك متوقفة'),
            subtitle: Text(on
                ? '${bank.config.packages.length} تطبيق مختار${pending > 0 ? ' · $pending بانتظار الإرسال' : ''}'
                : 'اختياري: فعله لترسل إشعارات تطبيقات البنك كأدلة للمراجعة.'),
            trailing: const Icon(Icons.chevron_left),
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => const BankReadingScreen()),
            ),
          ),
        );
      },
    );
  }
}

class BankNoticeCard extends StatelessWidget {
  const BankNoticeCard({super.key, required this.notice, required this.onTap});

  final BankNotice notice;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = bankStatusColor(notice.status);
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(formatMoney(notice.amount, notice.currency),
                        textDirection: TextDirection.ltr,
                        textAlign: TextAlign.start,
                        style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                  ),
                  StatusChip(label: bankStatusLabel(notice.status), color: color),
                ],
              ),
              const SizedBox(height: 4),
              Text(notice.text, maxLines: 3, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 8),
              ConfidenceBar(value: notice.confidence),
              const SizedBox(height: 6),
              Wrap(
                spacing: 12,
                runSpacing: 4,
                children: [
                  _Meta(icon: Icons.apps, text: notice.sourceApp),
                  if (notice.reference != null) _Meta(icon: Icons.tag, text: notice.reference!),
                  if (notice.orderNumber != null) _Meta(icon: Icons.receipt_long, text: notice.orderNumber!),
                  _Meta(icon: Icons.schedule, text: formatDateTime(notice.postedAt ?? notice.receivedAt)),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Meta extends StatelessWidget {
  const _Meta({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: Brand.ink500),
          const SizedBox(width: 3),
          Text(text, textDirection: TextDirection.ltr, style: Theme.of(context).textTheme.bodySmall),
        ],
      );
}

/// How sure the server's parser is about the amount and reference (0–100).
class ConfidenceBar extends StatelessWidget {
  const ConfidenceBar({super.key, required this.value});

  final int value;

  @override
  Widget build(BuildContext context) {
    final color = value >= 80 ? Brand.ok : (value >= 50 ? Brand.gold : Brand.bad);
    return Row(
      children: [
        Text('الثقة', style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(width: 8),
        Expanded(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(99),
            child: LinearProgressIndicator(
              value: value / 100,
              minHeight: 6,
              color: color,
              backgroundColor: color.withValues(alpha: 0.15),
            ),
          ),
        ),
        const SizedBox(width: 8),
        Text('$value%', style: Theme.of(context).textTheme.bodySmall),
      ],
    );
  }
}
