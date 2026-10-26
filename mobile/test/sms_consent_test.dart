import 'package:finpro_mobile/core/sms/sms_consent.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('SmsConsentStatus', () {
    test('maps persisted strings and fails closed on unknown values', () {
      expect(
        SmsConsentStatus.fromStorage('accepted'),
        SmsConsentStatus.accepted,
      );
      expect(
        SmsConsentStatus.fromStorage('declined'),
        SmsConsentStatus.declined,
      );
      expect(
        SmsConsentStatus.fromStorage('unknown'),
        SmsConsentStatus.unknown,
      );
      expect(SmsConsentStatus.fromStorage(null), SmsConsentStatus.unknown);
      expect(
        SmsConsentStatus.fromStorage('yes-please'),
        SmsConsentStatus.unknown,
      );
      expect(
        SmsConsentStatus.fromStorage(''),
        SmsConsentStatus.unknown,
      );
    });

    test('round-trips every status through its storage value', () {
      for (final status in SmsConsentStatus.values) {
        expect(
          SmsConsentStatus.fromStorage(status.storageValue),
          status,
        );
      }
    });
  });

  group('SmsConsentStore', () {
    setUp(() => SharedPreferences.setMockInitialValues({}));

    test('defaults to unknown when nothing was ever stored', () async {
      const store = SmsConsentStore();
      expect(await store.read(), SmsConsentStatus.unknown);
    });

    test('persists an explicit decline so the app does not re-prompt', () async {
      const store = SmsConsentStore();
      expect(await store.write(SmsConsentStatus.declined), isTrue);
      expect(await store.read(), SmsConsentStatus.declined);

      final prefs = await SharedPreferences.getInstance();
      expect(
        prefs.getString(SmsConsentStore.storageKey),
        SmsConsentStatus.declined.storageValue,
      );
    });

    test('persists acceptance', () async {
      const store = SmsConsentStore();
      expect(await store.write(SmsConsentStatus.accepted), isTrue);
      expect(await store.read(), SmsConsentStatus.accepted);
    });

    test('clear returns the record to unknown', () async {
      const store = SmsConsentStore();
      await store.write(SmsConsentStatus.accepted);
      expect(await store.clear(), isTrue);
      expect(await store.read(), SmsConsentStatus.unknown);
    });

    test('a corrupt stored value is treated as unknown', () async {
      SharedPreferences.setMockInitialValues({
        SmsConsentStore.storageKey: 'maybe',
      });
      const store = SmsConsentStore();
      expect(await store.read(), SmsConsentStatus.unknown);
    });
  });
}
