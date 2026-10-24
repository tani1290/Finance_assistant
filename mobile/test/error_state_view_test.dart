import 'package:finpro_mobile/shared/widgets/error_state_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('shows an explicit failure message and retries on demand', (
    tester,
  ) async {
    var retries = 0;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ErrorStateView(
            message: 'Your balances could not be loaded.',
            onRetry: () => retries++,
          ),
        ),
      ),
    );

    expect(find.text('Could not load data'), findsOneWidget);
    expect(find.text('Your balances could not be loaded.'), findsOneWidget);

    await tester.tap(find.text('Try Again'));
    await tester.pump();

    expect(retries, 1);
  });

  testWidgets('omits the retry action when no callback is supplied', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: ErrorStateView(message: 'Nothing to retry.')),
      ),
    );

    expect(find.text('Nothing to retry.'), findsOneWidget);
    expect(find.text('Try Again'), findsNothing);
  });
}
