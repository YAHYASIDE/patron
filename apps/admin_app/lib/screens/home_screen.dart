import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../app.dart';
import '../theme.dart';
import '../widgets/states.dart';

/// What needs the owner now: attention counts and open staff notifications.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  AttentionSummary? _attention;
  StaffNoticePage? _notices;
  Object? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final api = Services.of(context).api;
    setState(() => _loading = true);
    try {
      final results = await Future.wait([api.attention(), api.staffNotifications()]);
      if (!mounted) return;
      setState(() {
        _attention = results[0] as AttentionSummary;
        _notices = results[1] as StaffNoticePage;
        _error = null;
      });
    } on Object catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _open(StaffNotice n) async {
    final s = Services.of(context);
    if (n.unread) {
      try {
        await s.api.markNotificationRead(n.id);
      } on ApiException {
        // Opening the link still helps; the dot clears on the next refresh.
      }
    }
    await s.openUrl(s.settings.dashboardLink(n.link));
    if (mounted) await _load();
  }

  Future<void> _openOrder(AttentionItem item) {
    final s = Services.of(context);
    return s.openUrl(s.settings.dashboardLink(item.orderId == null ? '/orders' : '/orders/${item.orderId}'));
  }

  @override
  Widget build(BuildContext context) {
    final a = _attention;
    final n = _notices;
    return Scaffold(
      appBar: AppBar(
        title: const Text('ما يحتاج انتباهك'),
        actions: [
          IconButton(tooltip: 'تحديث', onPressed: _loading ? null : _load, icon: const Icon(Icons.refresh)),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            if (_loading && a == null) const LoadingBlock(),
            if (_error != null) ErrorBlock(error: _error!, onRetry: _load),
            if (a != null) ...[
              _Counters(summary: a),
              const SizedBox(height: 16),
              if (a.total == 0)
                const EmptyBlock(icon: Icons.check_circle_outline, text: 'لا شيء ينتظر. كل الطلبات تسير كما يجب.'),
              _Group(title: 'فشل التسليم', color: Brand.bad, group: a.failed, onTap: _openOrder),
              _Group(title: 'تسليم متأخر', color: Brand.warn, group: a.lateDelivery, onTap: _openOrder),
              _Group(title: 'تحويلات تنتظر المراجعة', color: Brand.gold, group: a.waitingTransfers, onTap: _openOrder),
              _Group(title: 'دفع مكرر', color: Brand.bad, group: a.duplicatePayments, onTap: _openOrder),
            ],
            if (n != null) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  Text('تنبيهات الفريق', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                  const SizedBox(width: 8),
                  if (n.unread > 0) Badge(label: Text('${n.unread}'), backgroundColor: Brand.bad),
                  const Spacer(),
                  Text('${n.open} مفتوح', style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
              const SizedBox(height: 8),
              if (n.data.isEmpty) const EmptyBlock(icon: Icons.notifications_none, text: 'لا تنبيهات مفتوحة.'),
              for (final notice in n.data) ...[
                StaffNoticeTile(notice: notice, onTap: () => _open(notice)),
                const SizedBox(height: 8),
              ],
            ],
          ],
        ),
      ),
    );
  }
}

class _Counters extends StatelessWidget {
  const _Counters({required this.summary});

  final AttentionSummary summary;

  @override
  Widget build(BuildContext context) {
    final tiles = [
      ('فشل', summary.failed.count, Brand.bad, Icons.error_outline),
      ('متأخر', summary.lateDelivery.count, Brand.warn, Icons.schedule),
      ('تحويلات', summary.waitingTransfers.count, Brand.gold, Icons.receipt_long_outlined),
      ('مكرر', summary.duplicatePayments.count, Brand.bad, Icons.copy_all_outlined),
    ];
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 8,
      crossAxisSpacing: 8,
      childAspectRatio: 2.2,
      children: [
        for (final (label, count, color, icon) in tiles)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Icon(icon, color: count > 0 ? color : Brand.ink500),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text('$count',
                            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                                  fontWeight: FontWeight.w800,
                                  color: count > 0 ? color : null,
                                )),
                        Text(label, style: Theme.of(context).textTheme.bodySmall),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class _Group extends StatelessWidget {
  const _Group({required this.title, required this.color, required this.group, required this.onTap});

  final String title;
  final Color color;
  final AttentionGroup group;
  final void Function(AttentionItem) onTap;

  @override
  Widget build(BuildContext context) {
    if (group.count == 0) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              color: color.withValues(alpha: 0.12),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Text('$title (${group.count})',
                  style: TextStyle(color: color, fontWeight: FontWeight.w800)),
            ),
            for (final item in group.items.take(5))
              ListTile(
                dense: true,
                onTap: () => onTap(item),
                title: Text(item.orderNumber ?? '—', textDirection: TextDirection.ltr, textAlign: TextAlign.start),
                subtitle: Text([
                  if (item.customer != null) item.customer!,
                  if (item.error != null) item.error!,
                ].join(' · '), maxLines: 2, overflow: TextOverflow.ellipsis),
                trailing: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(formatMoney(item.amount, item.currency), textDirection: TextDirection.ltr),
                    if (item.minutes != null)
                      Text(formatMinutes(item.minutes), style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
              ),
            if (group.count > 5)
              Padding(
                padding: const EdgeInsets.all(8),
                child: Text('و${group.count - 5} أخرى في لوحة التحكم',
                    textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodySmall),
              ),
          ],
        ),
      ),
    );
  }
}

class StaffNoticeTile extends StatelessWidget {
  const StaffNoticeTile({super.key, required this.notice, required this.onTap});

  final StaffNotice notice;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = priorityColor(notice.priority);
    final theme = Theme.of(context);
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(width: 5, color: color),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          if (notice.unread)
                            Padding(
                              padding: const EdgeInsetsDirectional.only(end: 6),
                              child: Icon(Icons.circle, size: 9, color: color),
                            ),
                          Expanded(
                            child: Text(notice.title,
                                style: theme.textTheme.titleSmall?.copyWith(
                                    fontWeight: notice.unread ? FontWeight.w800 : FontWeight.w600)),
                          ),
                          StatusChip(label: priorityLabel(notice.priority), color: color),
                        ],
                      ),
                      if (notice.body.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text(notice.body, maxLines: 3, overflow: TextOverflow.ellipsis),
                      ],
                      const SizedBox(height: 6),
                      Text(
                        [
                          formatAgo(notice.createdAt),
                          if (notice.remindCount > 0) 'تذكير ${notice.remindCount}',
                        ].where((s) => s.isNotEmpty).join(' · '),
                        style: theme.textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
