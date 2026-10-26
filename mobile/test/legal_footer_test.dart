import 'package:finpro_mobile/app/theme/app_theme.dart';
import 'package:finpro_mobile/shared/widgets/legal_footer.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('com.finpro.app/platform');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  tearDown(() {
    messenger.setMockMethodCallHandler(channel, null);
    messenger.setMockMethodCallHandler(SystemChannels.platform, null);
  });

  testWidgets('renders every legal destination', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.darkTheme(),
        home: const Scaffold(body: LegalFooter()),
      ),
    );

    expect(find.text('Privacy Policy'), findsOneWidget);
    expect(find.text('Terms'), findsOneWidget);
    expect(find.text('Delete account'), findsOneWidget);
  });

  testWidgets('can hide the deletion link where it would be redundant', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.darkTheme(),
        home: const Scaffold(
          body: LegalFooter(showDeletionLink: false),
        ),
      ),
    );

    expect(find.text('Privacy Policy'), findsOneWidget);
    expect(find.text('Terms'), findsOneWidget);
    expect(find.text('Delete account'), findsNothing);
  });

  testWidgets('falls back to copying the URL when no browser is available', (
    tester,
  ) async {
    final calls = <MethodCall>[];
    messenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      if (call.method == 'openUrl') return false;
      return null;
    });
    // Clipboard.setData goes through the system platform channel; without a
    // handler the fallback would abort before showing the copy notice.
    messenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async => null,
    );

    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.darkTheme(),
        home: const Scaffold(body: LegalFooter()),
      ),
    );

    await tester.tap(find.text('Terms'));
    await tester.pumpAndSettle();

    expect(calls.single.method, 'openUrl');
    expect(
      find.textContaining('Terms of Service link copied'),
      findsOneWidget,
    );
  });
}
