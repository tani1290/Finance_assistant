import 'package:finpro_mobile/core/legal/legal_links.dart';
import 'package:finpro_mobile/core/platform/external_link.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('com.finpro.app/platform');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  final calls = <MethodCall>[];

  void install(Future<Object?> Function(MethodCall call) handler) {
    messenger.setMockMethodCallHandler(channel, (call) {
      calls.add(call);
      return handler(call);
    });
  }

  setUp(calls.clear);

  tearDown(() {
    messenger.setMockMethodCallHandler(channel, null);
  });

  group('ExternalLink.open rejects unsafe targets locally', () {
    test('rejects relative and scheme-less strings', () async {
      install((_) async => true);
      expect(await ExternalLink.open('privacy.html'), isFalse);
      expect(await ExternalLink.open('/privacy.html'), isFalse);
      expect(await ExternalLink.open(''), isFalse);
      expect(calls, isEmpty);
    });

    test('rejects non-HTTP schemes', () async {
      install((_) async => true);
      expect(await ExternalLink.open('javascript:alert(1)'), isFalse);
      expect(await ExternalLink.open('file:///etc/passwd'), isFalse);
      expect(await ExternalLink.open('intent://evil'), isFalse);
      expect(await ExternalLink.open('mailto:support@example.com'), isFalse);
      expect(calls, isEmpty);
    });

    test('rejects HTTP URLs without a host', () async {
      install((_) async => true);
      expect(await ExternalLink.open('https:///privacy.html'), isFalse);
      expect(calls, isEmpty);
    });
  });

  group('ExternalLink.open forwards verified URLs', () {
    test('forwards HTTPS links and reports platform success', () async {
      install((_) async => true);

      expect(await ExternalLink.open(LegalLinks.privacyPolicy), isTrue);
      expect(calls.single.method, 'openUrl');
      expect(
        calls.single.arguments,
        {'url': LegalLinks.privacyPolicy},
      );
    });

    test('returns false when the platform cannot open a browser', () async {
      install((_) async => false);
      expect(await ExternalLink.open(LegalLinks.termsOfService), isFalse);
    });

    test('returns false when the platform returns null', () async {
      install((_) async => null);
      expect(await ExternalLink.open(LegalLinks.accountDeletion), isFalse);
    });

    test('returns false when the platform throws', () async {
      install((_) async => throw PlatformException(code: 'NO_ACTIVITY'));
      expect(await ExternalLink.open(LegalLinks.supportIssues), isFalse);
    });
  });
}
