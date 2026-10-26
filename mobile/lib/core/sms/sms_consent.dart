import 'package:shared_preferences/shared_preferences.dart';

/// What the user decided the last time the prominent SMS disclosure was shown.
///
/// `unknown` means the disclosure has never been answered. A persisted
/// `declined` is deliberately sticky: the app must not re-prompt a user who
/// already said no. The user can still change their mind from the Privacy &
/// Permissions screen, which is an explicit action rather than a prompt.
enum SmsConsentStatus {
  unknown,
  accepted,
  declined;

  static SmsConsentStatus fromStorage(String? raw) {
    return switch (raw) {
      'accepted' => SmsConsentStatus.accepted,
      'declined' => SmsConsentStatus.declined,
      _ => SmsConsentStatus.unknown,
    };
  }

  String get storageValue => switch (this) {
    SmsConsentStatus.unknown => 'unknown',
    SmsConsentStatus.accepted => 'accepted',
    SmsConsentStatus.declined => 'declined',
  };
}

/// Persists the SMS disclosure decision in `SharedPreferences`.
///
/// This is separate from the native detection flag. The native flag decides
/// whether the broadcast receiver processes messages; this record decides
/// whether the app is allowed to show the Android permission prompt again
/// without the user explicitly asking for it.
class SmsConsentStore {
  const SmsConsentStore();

  static const String storageKey = 'finpro_sms_consent_status';

  Future<SmsConsentStatus> read() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return SmsConsentStatus.fromStorage(prefs.getString(storageKey));
    } catch (_) {
      // A broken preferences backend must behave like "never asked" rather
      // than silently enabling anything.
      return SmsConsentStatus.unknown;
    }
  }

  /// Returns `true` when the decision was durably written.
  Future<bool> write(SmsConsentStatus status) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return await prefs.setString(storageKey, status.storageValue);
    } catch (_) {
      return false;
    }
  }

  Future<bool> clear() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return await prefs.remove(storageKey);
    } catch (_) {
      return false;
    }
  }
}
