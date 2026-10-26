import 'package:finpro_mobile/app/theme/app_theme.dart';
import 'package:finpro_mobile/core/sms/sms_consent.dart';
import 'package:finpro_mobile/features/privacy/privacy_permissions_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('com.finpro.app/sms_channel');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  final calls = <MethodCall>[];

  void install({
    bool granted = false,
    bool detectionStored = false,
    bool requestGranted = false,
    bool writeSucceeds = true,
  }) {
    messenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      switch (call.method) {
        case 'checkSmsPermission':
          return granted;
        case 'isSmsDetectionEnabled':
          return detectionStored;
        case 'requestSmsPermission':
          return requestGranted;
        case 'setSmsDetectionEnabled':
          return writeSucceeds;
        default:
          return null;
      }
    });
  }

  setUp(() {
    calls.clear();
    SharedPreferences.setMockInitialValues({});
  });

  tearDown(() {
    messenger.setMockMethodCallHandler(channel, null);
  });

  Future<void> pumpScreen(WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.darkTheme(),
        home: const PrivacyPermissionsScreen(),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> tapEnable(WidgetTester tester) async {
    final finder = find.text('Enable bank SMS detection');
    await tester.ensureVisible(finder);
    await tester.pumpAndSettle();
    await tester.tap(finder);
    await tester.pumpAndSettle();
  }

  testWidgets('starts off and never asks for permission on entry', (
    tester,
  ) async {
    install();

    await pumpScreen(tester);

    expect(tester.widget<Switch>(find.byType(Switch)).value, isFalse);
    expect(find.textContaining('works fully without SMS access'), findsOneWidget);
    expect(
      calls.where((call) => call.method == 'requestSmsPermission'),
      isEmpty,
    );
  });

  testWidgets('enabling shows the prominent disclosure before the prompt', (
    tester,
  ) async {
    install(requestGranted: true, writeSucceeds: true);

    await pumpScreen(tester);
    await tapEnable(tester);

    expect(find.text('Allow FinPro to read bank SMS?'), findsOneWidget);
    expect(find.text('Agree & continue'), findsOneWidget);
    expect(find.text('Not now'), findsOneWidget);
    // The OS prompt is not requested until the user agrees.
    expect(
      calls.where((call) => call.method == 'requestSmsPermission'),
      isEmpty,
    );
  });

  testWidgets('declining persists a decline and does not prompt Android', (
    tester,
  ) async {
    install(requestGranted: true);

    await pumpScreen(tester);
    await tapEnable(tester);
    await tester.tap(find.text('Not now'));
    await tester.pumpAndSettle();

    final prefs = await SharedPreferences.getInstance();
    expect(
      prefs.getString(SmsConsentStore.storageKey),
      SmsConsentStatus.declined.storageValue,
    );
    expect(
      calls.where((call) => call.method == 'requestSmsPermission'),
      isEmpty,
    );
    expect(tester.widget<Switch>(find.byType(Switch)).value, isFalse);
    expect(find.textContaining('previously declined'), findsOneWidget);
  });

  testWidgets('agreeing requests permission and stores detection on success', (
    tester,
  ) async {
    install(requestGranted: true, writeSucceeds: true);

    await pumpScreen(tester);
    await tapEnable(tester);
    await tester.tap(find.text('Agree & continue'));
    await tester.pumpAndSettle();

    expect(
      calls.any((call) => call.method == 'requestSmsPermission'),
      isTrue,
    );
    final write = calls.lastWhere(
      (call) => call.method == 'setSmsDetectionEnabled',
    );
    expect(write.arguments, {'enabled': true});

    final prefs = await SharedPreferences.getInstance();
    expect(
      prefs.getString(SmsConsentStore.storageKey),
      SmsConsentStatus.accepted.storageValue,
    );
    expect(tester.widget<Switch>(find.byType(Switch)).value, isTrue);
  });

  testWidgets('a failed native write never claims detection is on', (
    tester,
  ) async {
    install(requestGranted: true, writeSucceeds: false);

    await pumpScreen(tester);
    await tapEnable(tester);
    await tester.tap(find.text('Agree & continue'));
    await tester.pumpAndSettle();

    expect(tester.widget<Switch>(find.byType(Switch)).value, isFalse);
    expect(find.textContaining('could not be enabled'), findsOneWidget);
  });

  testWidgets('a denied Android permission leaves the app usable', (
    tester,
  ) async {
    install(requestGranted: false);

    await pumpScreen(tester);
    await tapEnable(tester);
    await tester.tap(find.text('Agree & continue'));
    await tester.pumpAndSettle();

    expect(tester.widget<Switch>(find.byType(Switch)).value, isFalse);
    expect(
      find.textContaining('FinPro still works without it'),
      findsOneWidget,
    );
  });
}
