import 'package:flutter_test/flutter_test.dart';

import 'package:patron_mobile/main.dart';

void main() {
  testWidgets('renders the scaffold home page', (WidgetTester tester) async {
    await tester.pumpWidget(const PatronApp());

    expect(find.text('Patron mobile scaffold'), findsOneWidget);
  });
}
