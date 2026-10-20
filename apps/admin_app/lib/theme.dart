import 'package:flutter/material.dart';

import 'api/models.dart';

/// Patron brand, shared with the dashboard and the store
/// (apps/admin/tailwind.config.ts): teal-green primary, warm gold accent.
class Brand {
  const Brand._();

  static const teal = Color(0xFF0D6D64);
  static const tealDeep = Color(0xFF07423C);
  static const tealSoft = Color(0xFF2DD4BF);
  static const gold = Color(0xFFC79A3A);
  static const ok = Color(0xFF15803D);
  static const warn = Color(0xFFB45309);
  static const bad = Color(0xFFB91C1C);
  static const ink500 = Color(0xFF5D706C);
}

ThemeData buildTheme(Brightness brightness) {
  final scheme = ColorScheme.fromSeed(
    seedColor: Brand.teal,
    brightness: brightness,
    primary: brightness == Brightness.light ? Brand.teal : Brand.tealSoft,
    secondary: Brand.gold,
    error: Brand.bad,
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    visualDensity: VisualDensity.standard,
    appBarTheme: const AppBarTheme(centerTitle: false),
    cardTheme: CardThemeData(
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: scheme.outlineVariant),
      ),
    ),
    inputDecorationTheme: const InputDecorationTheme(border: OutlineInputBorder()),
  );
}

Color priorityColor(StaffPriority p) => switch (p) {
      StaffPriority.urgent => Brand.bad,
      StaffPriority.high => Brand.warn,
      StaffPriority.normal => Brand.teal,
      StaffPriority.low => Brand.ink500,
    };

String priorityLabel(StaffPriority p) => switch (p) {
      StaffPriority.urgent => 'عاجل',
      StaffPriority.high => 'مهم',
      StaffPriority.normal => 'عادي',
      StaffPriority.low => 'منخفض',
    };

Color bankStatusColor(BankNoticeStatus s) => switch (s) {
      BankNoticeStatus.newNotice => Brand.teal,
      BankNoticeStatus.suggested => Brand.gold,
      BankNoticeStatus.confirmed => Brand.ok,
      BankNoticeStatus.ignored => Brand.ink500,
      BankNoticeStatus.duplicate => Brand.warn,
      BankNoticeStatus.unknown => Brand.ink500,
    };

String bankStatusLabel(BankNoticeStatus s) => switch (s) {
      BankNoticeStatus.newNotice => 'جديد',
      BankNoticeStatus.suggested => 'مطابقة مقترحة',
      BankNoticeStatus.confirmed => 'أكده المالك',
      BankNoticeStatus.ignored => 'متجاهل',
      BankNoticeStatus.duplicate => 'مكرر',
      BankNoticeStatus.unknown => 'غير معروف',
    };

/// Latin digits everywhere (the dashboard does the same).
String two(int n) => n.toString().padLeft(2, '0');

String formatDateTime(DateTime? d) {
  if (d == null) return '—';
  final l = d.toLocal();
  return '${l.year}-${two(l.month)}-${two(l.day)} ${two(l.hour)}:${two(l.minute)}';
}

String formatAgo(DateTime? d, [DateTime? now]) {
  if (d == null) return '';
  final diff = (now ?? DateTime.now()).difference(d);
  if (diff.inMinutes < 1) return 'الآن';
  if (diff.inMinutes < 60) return 'منذ ${diff.inMinutes} د';
  if (diff.inHours < 24) return 'منذ ${diff.inHours} س';
  return 'منذ ${diff.inDays} ي';
}

String formatMinutes(int? m) {
  if (m == null) return '';
  if (m < 60) return '$m د';
  if (m < 60 * 24) return '${m ~/ 60} س';
  return '${m ~/ (60 * 24)} ي';
}

String formatMoney(String? amount, String? currency) {
  if (amount == null || amount.isEmpty) return '—';
  final n = double.tryParse(amount);
  final text = n == null
      ? amount
      : (n == n.roundToDouble() ? n.toStringAsFixed(0) : n.toStringAsFixed(2));
  return currency == null || currency.isEmpty ? text : '$text $currency';
}
