import 'package:finpro_mobile/app/theme/app_theme.dart';
import 'package:finpro_mobile/core/auth/auth_notifier.dart';
import 'package:finpro_mobile/core/auth/auth_state.dart';
import 'package:finpro_mobile/core/models/user_model.dart';
import 'package:finpro_mobile/features/legal/delete_account_screen.dart';
import 'package:finpro_mobile/shared/widgets/gradient_button.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// A signed-in session that never kicks off session restoration, so the screen
/// under test is not flipped to unauthenticated by a microtask.
class _StubAuthenticatedAuth extends AuthNotifier {
  @override
  AuthState build() => AuthState.authenticated(
    UserModel(
      id: 'user-1',
      email: 'user@example.com',
      username: 'user',
      firstName: 'Test',
      lastName: 'User',
    ),
  );
}

Widget _wrap() {
  return ProviderScope(
    overrides: [authProvider.overrideWith(_StubAuthenticatedAuth.new)],
    child: MaterialApp(
      theme: AppTheme.darkTheme(),
      home: const DeleteAccountScreen(),
    ),
  );
}

VoidCallback? _deleteAction(WidgetTester tester) {
  return tester.widget<GradientButton>(find.byType(GradientButton)).onPressed;
}

void main() {
  testWidgets('cannot submit until DELETE is typed and acknowledged', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap());
    await tester.pump();

    expect(_deleteAction(tester), isNull);

    // The confirmation field is the second TextField on the screen (password
    // first). A near-miss must not unlock the destructive action.
    await tester.enterText(find.byType(TextField).at(1), 'delete');
    await tester.pump();
    expect(_deleteAction(tester), isNull);

    await tester.enterText(find.byType(TextField).at(1), 'DELETE ');
    await tester.pump();
    expect(_deleteAction(tester), isNull);

    await tester.ensureVisible(find.byType(CheckboxListTile));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(CheckboxListTile));
    await tester.pump();
    expect(_deleteAction(tester), isNotNull);

    await tester.enterText(find.byType(TextField).at(1), 'DELETE');
    await tester.pump();
    expect(_deleteAction(tester), isNotNull);
  });

  testWidgets('acknowledgement alone is not enough', (tester) async {
    await tester.pumpWidget(_wrap());
    await tester.pump();

    await tester.ensureVisible(find.byType(CheckboxListTile));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(CheckboxListTile));
    await tester.pump();

    expect(_deleteAction(tester), isNull);
  });

  testWidgets('the password field is optional and the flow is explained', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap());
    await tester.pump();

    expect(find.text('Current password'), findsOneWidget);
    expect(
      find.textContaining('Leave blank only if your account has no FinPro password'),
      findsOneWidget,
    );
    expect(find.text('Permanently delete my account'), findsOneWidget);
    expect(
      find.textContaining('Deletion cannot be undone'),
      findsOneWidget,
    );
  });
}
