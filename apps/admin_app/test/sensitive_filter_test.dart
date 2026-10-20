import 'package:flutter_test/flutter_test.dart';
import 'package:patron_admin/bank/sensitive_filter.dart';

void main() {
  group('SensitiveFilter drops secrets', () {
    final secrets = <String>[
      'Your OTP is 482913. Do not share it.',
      '482913 is your verification code',
      'Votre code de vérification est 7731',
      'Code de confirmation : 99123',
      'Votre mot de passe temporaire: Xk29aa',
      'رمز التحقق الخاص بك هو 5521',
      'كلمة المرور المؤقتة: 8812',
      'لا تشارك هذا الرمز مع أحد: 1234',
      'Your PIN has been changed',
      'Use one-time passcode 1122 to log in',
      'Bankily: code 8841',
      'كود 99812',
      'رمز: 4471',
      'Votre code 1234',
    ];
    for (final s in secrets) {
      test('drops "$s"', () {
        final r = SensitiveFilter.apply(title: 'Bank', text: s);
        expect(r.dropped, isTrue, reason: s);
        expect(r.text, isNull);
        expect(r.title, isNull);
      });
    }

    test('a secret word in the title alone is enough', () {
      final r = SensitiveFilter.apply(title: 'OTP', text: '5521');
      expect(r.dropped, isTrue);
      expect(r.dropReason, DropReason.secretKeyword);
    });

    test('empty text is dropped', () {
      expect(SensitiveFilter.apply(title: 'x', text: '   ').dropReason, DropReason.empty);
    });
  });

  group('SensitiveFilter keeps payment notices', () {
    final payments = <String>[
      'Vous avez reçu 1500 MRU de 22334455. Réf: TX99812',
      'تم استلام تحويل بمبلغ 2500 أوقية من أحمد. المرجع 77812',
      'Transfer received: 300.00 MRU, reference PTN-20261020-000123',
      'Code de transaction: 88123456, montant 1000 MRU',
      'Paiement reçu 450 MRU — numéro de commande 99001',
    ];
    for (final s in payments) {
      test('keeps "$s"', () {
        final r = SensitiveFilter.apply(title: 'Bankily', text: s);
        expect(r.dropped, isFalse, reason: s);
        expect(r.text, s);
        expect(r.title, 'Bankily');
      });
    }

    test('trims and turns an empty title into null', () {
      final r = SensitiveFilter.apply(title: '  ', text: '  Reçu 100 MRU  ');
      expect(r.title, isNull);
      expect(r.text, 'Reçu 100 MRU');
    });
  });

  group('card numbers', () {
    test('are masked to the last 4 digits', () {
      final r = SensitiveFilter.apply(text: 'Débit carte 4111 1111 1111 1234 de 500 MRU');
      expect(r.text, 'Débit carte •••• 1234 de 500 MRU');
    });

    test('dashes and runs of 16 digits too', () {
      expect(SensitiveFilter.maskCardNumbers('card 5500-0000-0000-0004 ok'), 'card •••• 0004 ok');
      expect(SensitiveFilter.maskCardNumbers('5500000000000004'), '•••• 0004');
    });

    test('dashed order numbers stay; a bare 13+ digit run counts as a card', () {
      const s = 'Réf PTN-20261020-000123 / 20261020000123';
      expect(SensitiveFilter.maskCardNumbers(s), 'Réf PTN-20261020-000123 / •••• 0123');
    });

    test('short numbers (amounts, phone, references) are untouched', () {
      const s = 'Reçu 15000 MRU de 22334455 réf 778812';
      expect(SensitiveFilter.maskCardNumbers(s), s);
    });
  });
}
