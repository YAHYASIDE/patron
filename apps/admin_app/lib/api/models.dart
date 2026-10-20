// JSON contracts of the staff endpoints this app reads. Parsing is lenient on
// purpose: a field the server adds later must not break an installed APK, and
// a missing optional field shows as empty instead of crashing the screen.

String? _str(Object? v) => v?.toString();

int _int(Object? v, [int fallback = 0]) {
  if (v is int) return v;
  if (v is num) return v.toInt();
  if (v is String) return int.tryParse(v) ?? fallback;
  return fallback;
}

DateTime? _date(Object? v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;

Map<String, dynamic> _map(Object? v) => v is Map ? v.cast<String, dynamic>() : const {};

List<Map<String, dynamic>> _list(Object? v) =>
    v is List ? v.whereType<Map>().map((m) => m.cast<String, dynamic>()).toList() : const [];

class TokenPair {
  const TokenPair({required this.accessToken, required this.refreshToken});

  factory TokenPair.fromJson(Map<String, dynamic> json) {
    final access = json['accessToken'];
    final refresh = json['refreshToken'];
    if (access is! String || refresh is! String || access.isEmpty || refresh.isEmpty) {
      throw const FormatException('token pair missing');
    }
    return TokenPair(accessToken: access, refreshToken: refresh);
  }

  final String accessToken;
  final String refreshToken;
}

// ─── Attention (GET /admin/orders/attention) ───

/// One row of an attention list. Failed / late rows are orders; transfer and
/// duplicate rows are payments carrying their order under `order`.
class AttentionItem {
  const AttentionItem({
    this.orderId,
    this.orderNumber,
    this.paymentId,
    this.amount,
    this.currency,
    this.customer,
    this.minutes,
    this.error,
  });

  factory AttentionItem.fromJson(Map<String, dynamic> json) {
    final order = json['order'] is Map ? _map(json['order']) : json;
    final user = _map(order['user']);
    return AttentionItem(
      orderId: _str(order['id']),
      orderNumber: _str(order['orderNumber']),
      paymentId: _str(json['paymentId']),
      amount: _str(json['amount'] ?? order['total']),
      currency: _str(json['currency'] ?? order['currency']),
      customer: _str(user['fullName'] ?? user['phone']),
      minutes: json['minutes'] == null ? null : _int(json['minutes']),
      error: _str(json['error']),
    );
  }

  final String? orderId;
  final String? orderNumber;
  final String? paymentId;
  final String? amount;
  final String? currency;
  final String? customer;
  final int? minutes;
  final String? error;
}

class AttentionGroup {
  const AttentionGroup({required this.count, required this.items});

  factory AttentionGroup.fromJson(Object? raw) {
    final json = _map(raw);
    return AttentionGroup(
      count: _int(json['count']),
      items: _list(json['items']).map(AttentionItem.fromJson).toList(),
    );
  }

  static const empty = AttentionGroup(count: 0, items: []);

  final int count;
  final List<AttentionItem> items;
}

class AttentionSummary {
  const AttentionSummary({
    required this.total,
    required this.failed,
    required this.lateDelivery,
    required this.waitingTransfers,
    required this.duplicatePayments,
  });

  factory AttentionSummary.fromJson(Map<String, dynamic> json) {
    final failed = AttentionGroup.fromJson(json['failed']);
    final late = AttentionGroup.fromJson(json['lateDelivery']);
    final transfers = AttentionGroup.fromJson(json['waitingTransfers']);
    final duplicates = AttentionGroup.fromJson(json['duplicatePayments']);
    return AttentionSummary(
      total: json['total'] == null
          ? failed.count + late.count + transfers.count + duplicates.count
          : _int(json['total']),
      failed: failed,
      lateDelivery: late,
      waitingTransfers: transfers,
      duplicatePayments: duplicates,
    );
  }

  final int total;
  final AttentionGroup failed;
  final AttentionGroup lateDelivery;
  final AttentionGroup waitingTransfers;
  final AttentionGroup duplicatePayments;
}

// ─── Staff notifications (GET /admin/staff-notifications) ───

enum StaffPriority { low, normal, high, urgent }

StaffPriority parsePriority(Object? v) => switch (_str(v)?.toUpperCase()) {
      'LOW' => StaffPriority.low,
      'HIGH' => StaffPriority.high,
      'URGENT' => StaffPriority.urgent,
      _ => StaffPriority.normal,
    };

class StaffNotice {
  const StaffNotice({
    required this.id,
    required this.type,
    required this.priority,
    required this.title,
    required this.body,
    this.link,
    this.createdAt,
    this.readAt,
    this.resolvedAt,
    this.remindCount = 0,
  });

  factory StaffNotice.fromJson(Map<String, dynamic> json) => StaffNotice(
        id: _str(json['id']) ?? '',
        type: _str(json['type']) ?? '',
        priority: parsePriority(json['priority']),
        title: _str(json['title']) ?? '',
        body: _str(json['body']) ?? '',
        link: _str(json['link']),
        createdAt: _date(json['createdAt']),
        readAt: _date(json['readAt']),
        resolvedAt: _date(json['resolvedAt']),
        remindCount: _int(json['remindCount']),
      );

  final String id;
  final String type;
  final StaffPriority priority;
  final String title;
  final String body;
  final String? link;
  final DateTime? createdAt;
  final DateTime? readAt;
  final DateTime? resolvedAt;
  final int remindCount;

  bool get unread => readAt == null;
}

class StaffNoticePage {
  const StaffNoticePage({required this.data, required this.unread, required this.open});

  factory StaffNoticePage.fromJson(Map<String, dynamic> json) {
    final data = _list(json['data']).map(StaffNotice.fromJson).toList();
    return StaffNoticePage(
      data: data,
      unread: json['unread'] == null ? data.where((n) => n.unread).length : _int(json['unread']),
      open: json['open'] == null ? data.length : _int(json['open']),
    );
  }

  final List<StaffNotice> data;
  final int unread;
  final int open;
}

// ─── Bank notices (/admin/bank-notices) ───

enum BankNoticeStatus { newNotice, suggested, confirmed, ignored, duplicate, unknown }

BankNoticeStatus parseBankStatus(Object? v) => switch (_str(v)?.toUpperCase()) {
      'NEW' => BankNoticeStatus.newNotice,
      'SUGGESTED' => BankNoticeStatus.suggested,
      'CONFIRMED' => BankNoticeStatus.confirmed,
      'IGNORED' => BankNoticeStatus.ignored,
      'DUPLICATE' => BankNoticeStatus.duplicate,
      _ => BankNoticeStatus.unknown,
    };

String bankStatusToApi(BankNoticeStatus s) => switch (s) {
      BankNoticeStatus.newNotice => 'NEW',
      BankNoticeStatus.suggested => 'SUGGESTED',
      BankNoticeStatus.confirmed => 'CONFIRMED',
      BankNoticeStatus.ignored => 'IGNORED',
      BankNoticeStatus.duplicate => 'DUPLICATE',
      BankNoticeStatus.unknown => '',
    };

/// What the phone sends: the masked notification, nothing else.
class BankNoticeUpload {
  const BankNoticeUpload({
    required this.deviceId,
    required this.sourceApp,
    this.title,
    required this.text,
    required this.postedAt,
  });

  final String deviceId;
  final String sourceApp;
  final String? title;
  final String text;
  final DateTime postedAt;

  Map<String, dynamic> toJson() => {
        'deviceId': deviceId,
        'sourceApp': sourceApp,
        if (title != null && title!.isNotEmpty) 'title': title,
        'text': text,
        'postedAt': postedAt.toUtc().toIso8601String(),
      };
}

/// The server's answer to an upload (201).
class BankNoticeReceipt {
  const BankNoticeReceipt({
    required this.id,
    required this.status,
    this.duplicate = false,
    this.amount,
    this.currency,
    this.reference,
    this.confidence = 0,
  });

  factory BankNoticeReceipt.fromJson(Map<String, dynamic> json) => BankNoticeReceipt(
        id: _str(json['id']) ?? '',
        status: parseBankStatus(json['status']),
        duplicate: json['duplicate'] == true,
        amount: _str(json['amount']),
        currency: _str(json['currency']),
        reference: _str(json['reference']),
        confidence: _int(json['confidence']).clamp(0, 100),
      );

  final String id;
  final BankNoticeStatus status;
  final bool duplicate;
  final String? amount;
  final String? currency;
  final String? reference;
  final int confidence;

  BankNoticeReceipt withStatus(BankNoticeStatus s) => BankNoticeReceipt(
        id: id,
        status: s,
        duplicate: duplicate,
        amount: amount,
        currency: currency,
        reference: reference,
        confidence: confidence,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'status': bankStatusToApi(status),
        'duplicate': duplicate,
        'amount': amount,
        'currency': currency,
        'reference': reference,
        'confidence': confidence,
      };
}

/// A notice as the dashboard sees it (GET list).
class BankNotice {
  const BankNotice({
    required this.id,
    required this.status,
    required this.sourceApp,
    this.title,
    required this.text,
    this.postedAt,
    this.receivedAt,
    this.amount,
    this.currency,
    this.reference,
    this.sender,
    this.confidence = 0,
    this.orderId,
    this.orderNumber,
  });

  factory BankNotice.fromJson(Map<String, dynamic> json) {
    // The suggested order may come flat or nested, depending on the server version.
    final order = _map(json['order'] ?? json['suggestedOrder']);
    return BankNotice(
      id: _str(json['id']) ?? '',
      status: parseBankStatus(json['status']),
      sourceApp: _str(json['sourceApp']) ?? '',
      title: _str(json['title']),
      text: _str(json['text']) ?? '',
      postedAt: _date(json['postedAt']),
      receivedAt: _date(json['receivedAt']),
      amount: _str(json['amount']),
      currency: _str(json['currency']),
      reference: _str(json['reference']),
      sender: _str(json['sender']),
      confidence: _int(json['confidence']).clamp(0, 100),
      orderId: _str(order['id'] ?? json['orderId'] ?? json['suggestedOrderId']),
      orderNumber: _str(order['orderNumber'] ?? json['orderNumber']),
    );
  }

  final String id;
  final BankNoticeStatus status;
  final String sourceApp;
  final String? title;
  final String text;
  final DateTime? postedAt;
  final DateTime? receivedAt;
  final String? amount;
  final String? currency;
  final String? reference;
  final String? sender;
  final int confidence;
  final String? orderId;
  final String? orderNumber;
}
