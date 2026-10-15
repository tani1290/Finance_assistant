
class ApiEndpoints {
  // Configurable base URL
  static String defaultBaseUrl() {
    return 'https://finpro-finance-ai.onrender.com/api/v1';
  }

  static String baseUrl = defaultBaseUrl();

  // Auth
  static String get login => '$baseUrl/auth/login';
  static String get register => '$baseUrl/auth/register';
  static String get refresh => '$baseUrl/auth/refresh';
  static String get me => '$baseUrl/auth/me';
  static String get logout => '$baseUrl/auth/logout';

  // Notifications / FCM
  static String get fcmToken => '$baseUrl/notifications/fcm-token';

  // Core Financial Modules
  static String get onboarding => '$baseUrl/onboarding';
  static String get dashboard => '$baseUrl/dashboard';
  static String get analytics => '$baseUrl/analytics';
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
  static String smsPendingConfirm(String id) =>
      '$baseUrl/sms/pending/$id/confirm';
  static String smsPendingReject(String id) =>
      '$baseUrl/sms/pending/$id/reject';
  static String get smsParsePreview => '$baseUrl/sms/parse';
}
