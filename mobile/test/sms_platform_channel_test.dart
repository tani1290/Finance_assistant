import 'package:finpro_mobile/core/sms/sms_platform_channel.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('com.finpro.app/sms_channel');
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

  group('permission queries fail closed', () {
    test('checkPermission is false when the platform returns null', () async {
      install((_) async => null);
      expect(await SmsPlatformChannel.checkPermission(), isFalse);
    });

    test('checkPermission is false when the platform throws', () async {
      install((_) async => throw PlatformException(code: 'UNAVAILABLE'));
      expect(await SmsPlatformChannel.checkPermission(), isFalse);
    });

    test('checkPermission reflects a real grant', () async {
      install((_) async => true);
      expect(await SmsPlatformChannel.checkPermission(), isTrue);
    });

    test('requestPermission is false when the platform throws', () async {
      install((_) async => throw PlatformException(code: 'DENIED'));
      expect(await SmsPlatformChannel.requestPermission(), isFalse);
    });

    test('requestPermission reflects the user decision', () async {
      install((_) async => false);
      expect(await SmsPlatformChannel.requestPermission(), isFalse);

      install((_) async => true);
      expect(await SmsPlatformChannel.requestPermission(), isTrue);
    });
  });

  group('detection preference', () {
    test('isDetectionEnabled defaults to false when unreadable', () async {
      install((_) async => null);
      expect(await SmsPlatformChannel.isDetectionEnabled(), isFalse);

      install((_) async => throw PlatformException(code: 'UNAVAILABLE'));
      expect(await SmsPlatformChannel.isDetectionEnabled(), isFalse);
    });

    test('isDetectionEnabled returns the stored boolean', () async {
      install((_) async => true);
      expect(await SmsPlatformChannel.isDetectionEnabled(), isTrue);

      install((_) async => false);
      expect(await SmsPlatformChannel.isDetectionEnabled(), isFalse);
    });

    test('setDetectionEnabled reports only a successful write', () async {
      install((_) async => true);
      expect(await SmsPlatformChannel.setDetectionEnabled(true), isTrue);
      expect(calls.last.method, 'setSmsDetectionEnabled');
      expect(calls.last.arguments, {'enabled': true});

      install((_) async => false);
      expect(await SmsPlatformChannel.setDetectionEnabled(true), isFalse);

      install((_) async => null);
      expect(await SmsPlatformChannel.setDetectionEnabled(false), isFalse);

      install((_) async => throw PlatformException(code: 'WRITE_FAILED'));
      expect(await SmsPlatformChannel.setDetectionEnabled(false), isFalse);
    });

    test('a non-boolean reply is treated as a failed write', () async {
      install((_) async => 'ok');
      expect(await SmsPlatformChannel.setDetectionEnabled(true), isFalse);
    });
  });

  group('buffered messages', () {
    test('an unreadable buffer yields an empty list', () async {
      install((_) async => throw PlatformException(code: 'UNAVAILABLE'));
      expect(await SmsPlatformChannel.getBufferedSms(), isEmpty);
    });

    test('clearBufferedSms never throws on platform failure', () async {
      install((_) async => throw PlatformException(code: 'UNAVAILABLE'));
      await expectLater(
        SmsPlatformChannel.clearBufferedSms(),
        completes,
      );
    });
  });
}
