/// Keeps one-time codes, PINs and passwords off the network.
///
/// The Android listener (SensitiveText.kt) applies the same rules before a
/// notification ever leaves the listener; this Dart copy runs again on every
/// item the app receives from the listener, so a change on one side cannot
/// silently weaken the other. Keep the two rule sets identical.
///
/// Rules:
/// 1. Anything that reads like an OTP / PIN / password message is dropped
///    whole: a bank's login code is never payment evidence.
/// 2. Card numbers (13–19 digits) are masked to the last 4.
library;

/// Why a notification was kept off the queue. Only the reason is kept on the
/// phone (as a counter), never the text.
enum DropReason { secretKeyword, codePattern, empty }

class FilterResult {
  const FilterResult.kept({required this.title, required this.text}) : dropReason = null;
  const FilterResult.dropped(DropReason reason)
      : dropReason = reason,
        title = null,
        text = null;

  final String? title;
  final String? text;
  final DropReason? dropReason;

  bool get dropped => dropReason != null;
}

class SensitiveFilter {
  const SensitiveFilter._();

  /// Words that only appear in secrets messages (Arabic, French, English).
  static final RegExp _secretWords = RegExp(
    r'(\botp\b|one[\s-]?time|verification code|security code|confirmation code|'
    r'auth(entication)? code|pass\s?code|password|\bpin\b|'
    r'mot de passe|code (de )?(v[ée]rification|confirmation|s[ée]curit[ée]|secret|pin)|'
    r'ne (le )?partagez|do not share|don.?t share|never share|'
    r'رمز التحقق|رمز التأكيد|رمز التفعيل|رمز الدخول|رمز سري|الرمز السري|'
    r'كلمة السر|كلمة المرور|كلمة العبور|كود التحقق|كود التفعيل|رمز لمرة واحدة|'
    r'لا تشارك|لا تعط)',
    caseSensitive: false,
    unicode: true,
  );

  /// "code: 482913", "كود 4829", "123456 is your code", "votre code 1234".
  static final RegExp _codePattern = RegExp(
    r'((\bcode\b|كود|رمز)\s*[:：-]?\s*\d{4,8}\b)|'
    r'(\b\d{4,8}\s+(is your|est votre)\b)|'
    r'((your|votre) code\b)',
    caseSensitive: false,
    unicode: true,
  );

  /// A card number: 13–19 digits in one run, or grouped by four
  /// ("4111 1111 1111 1234"). Order numbers like PTN-20261020-000123 and
  /// references are left alone.
  static final RegExp _cardNumber = RegExp(r'\b(?:\d{13,19}|(?:\d{4}[ -]){3}\d{1,7})\b');

  static FilterResult apply({String? title, required String text}) {
    final t = (title ?? '').trim();
    final body = text.trim();
    if (body.isEmpty) return const FilterResult.dropped(DropReason.empty);

    final joined = '$t\n$body';
    if (_secretWords.hasMatch(joined)) {
      return const FilterResult.dropped(DropReason.secretKeyword);
    }
    if (_codePattern.hasMatch(joined)) {
      return const FilterResult.dropped(DropReason.codePattern);
    }
    return FilterResult.kept(
      title: t.isEmpty ? null : maskCardNumbers(t),
      text: maskCardNumbers(body),
    );
  }

  /// "4111 1111 1111 1234" → "•••• 1234".
  static String maskCardNumbers(String input) {
    return input.replaceAllMapped(_cardNumber, (m) {
      final digits = m[0]!.replaceAll(RegExp(r'[ -]'), '');
      return '•••• ${digits.substring(digits.length - 4)}';
    });
  }
}
