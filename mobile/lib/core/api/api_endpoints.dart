import 'dart:io';

class ApiEndpoints {
  // Configurable base URL
  static String defaultBaseUrl() {
    if (Platform.isAndroid) {
      // 127.0.0.1 routes directly to host machine with 'adb reverse tcp:5001 tcp:5001'
      return 'http://127.0.0.1:5001/api/v1';
    }
    return 'http://localhost:5001/api/v1';
  }

  static String baseUrl = defaultBaseUrl();

  // Auth
  static String get login => '$baseUrl/auth/login';
  static String get register => '$baseUrl/auth/register';
  static String get refresh => '$baseUrl/auth/refresh';
  static String get me => '$baseUrl/auth/me';
  static String get logout => '$baseUrl/auth/logout';
  static String get googleToken => '$baseUrl/auth/google/token'; // Firebase ID token exchange

  // Notifications / FCM
  static String get fcmToken => '$baseUrl/notifications/fcm-token';

  // Core Financial Modules
  static String get onboarding => '$baseUrl/onboarding';
  static String get dashboard => '$baseUrl/dashboard';
  static String get accounts => '$baseUrl/accounts';
  static String get transactions => '$baseUrl/transactions';
  static String get budgets => '$baseUrl/budgets';
  static String get goals => '$baseUrl/goals';
  static String get investments => '$baseUrl/investments';
  static String get portfolio => '$baseUrl/investments/portfolio';
  static String get loans => '$baseUrl/loans';
  static String get notifications => '$baseUrl/notifications';
  static String get financialHealth => '$baseUrl/ai/financial-health';
  static String get aiChat => '$baseUrl/ai/chat';
  static String get aiSnapshot => '$baseUrl/ai/snapshot';

  // Mobile Sync & SMS Ingestion
  static String get mobileDeviceRegister => '$baseUrl/mobile/devices';
  static String get mobileSync => '$baseUrl/mobile/sync';
  static String get smsIngest => '$baseUrl/sms/ingest';
  static String get smsBatchIngest => '$baseUrl/sms/batch-ingest';
  static String get smsPending => '$baseUrl/sms/pending';
  static String smsPendingConfirm(String id) => '$baseUrl/sms/pending/$id/confirm';
  static String smsPendingReject(String id) => '$baseUrl/sms/pending/$id/reject';
  static String get smsParsePreview => '$baseUrl/sms/parse';
}
