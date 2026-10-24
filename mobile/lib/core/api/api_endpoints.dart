import 'package:flutter/foundation.dart';

import '../config/app_environment.dart';

class ApiEndpoints {
  static String? _baseUrl;

  /// The effective API base URL.
  ///
  /// Resolved lazily on first use through [AppEnvironment], which rejects an
  /// insecure or malformed configuration. [main] resolves and assigns this
  /// eagerly so a bad configuration surfaces as a dedicated error screen
  /// rather than a mid-request failure.
  static String get baseUrl => _baseUrl ??= AppEnvironment.resolve();

  /// Overrides the base URL. Used by [main] at startup and by the debug-only
  /// runtime host override. Validation is lenient here for the debug editor;
  /// build-time configuration goes through [AppEnvironment.validate].
  static set baseUrl(String value) {
    _baseUrl = AppEnvironment.normalizeForRuntime(value);
  }

  /// Restores lazy resolution. Intended for tests.
  @visibleForTesting
  static void resetBaseUrl() {
    _baseUrl = null;
  }

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
  static String get analyticsForecast => '$baseUrl/analytics/forecast';
  static String get analyticsInsights => '$baseUrl/analytics/insights';
  static String get accounts => '$baseUrl/accounts';
  static String get transactions => '$baseUrl/transactions';
  static String get budgets => '$baseUrl/budgets';
  static String get goals => '$baseUrl/goals';
  static String get investments => '$baseUrl/investments';
  static String get portfolio => '$baseUrl/investments/portfolio';
  static String get loans => '$baseUrl/loans';
  static String get notifications => '$baseUrl/notifications';
  static String notification(String id) => '$baseUrl/notifications/$id';
  static String notificationRead(String id) =>
      '$baseUrl/notifications/$id/read';
  static String get notificationsReadAll => '$baseUrl/notifications/read-all';
  static String get financialHealth => '$baseUrl/ai/financial-health';
  static String get aiChat => '$baseUrl/ai/chat';
  static String get aiHistory => '$baseUrl/ai/history';
  static String get aiSnapshot => '$baseUrl/ai/snapshot';
  static String get insuranceReview => '$baseUrl/ai/insurance-review';

  // Financial calendar (EMIs, renewals, goal deadlines and custom reminders).
  /// Collection endpoint: `POST` here creates a custom event.
  static String get calendarEventsBase => '$baseUrl/calendar/events';

  /// Month-scoped listing, e.g. `/calendar/events?month=10&year=2026`.
  static String calendarEvents(int month, int year) =>
      '$calendarEventsBase?month=$month&year=$year';
  static String calendarEvent(String id) => '$calendarEventsBase/$id';

  // Insurance policies and recurring subscriptions.
  static String get insurance => '$baseUrl/insurance';
  static String insurancePolicy(String id) => '$baseUrl/insurance/$id';
  static String get subscriptions => '$baseUrl/subscriptions';
  static String subscription(String id) => '$baseUrl/subscriptions/$id';

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

  // Item-level access for update/delete of a single record.
  static String account(String id) => '$baseUrl/accounts/$id';
  static String accountDeposit(String id) => '$baseUrl/accounts/$id/deposit';
  static String transaction(String id) => '$baseUrl/transactions/$id';
  static String budget(String id) => '$baseUrl/budgets/$id';
  static String goal(String id) => '$baseUrl/goals/$id';
  static String goalContribute(String id) => '$baseUrl/goals/$id/contribute';
  static String loan(String id) => '$baseUrl/loans/$id';
  static String investment(String id) => '$baseUrl/investments/$id';
  static String get investmentBuy => '$baseUrl/investments/buy';

  // Synthetic payment simulator (demo only).
  //
  // These routes never contact a bank, card network or UPI provider and the
  // server gates every mutation behind an explicit demo-only opt-in. The
  // status route stays readable so the UI can explain a disabled simulator.
  static String get simulatorStatus => '$baseUrl/simulator/status';
  static String get simulatorSeed => '$baseUrl/simulator/seed';
  static String get simulatorReset => '$baseUrl/simulator/reset';
  static String get simulatorPayments => '$baseUrl/simulator/payments';
  static String simulatorPayment(String id) => '$baseUrl/simulator/payments/$id';
  static String simulatorPaymentConfirm(String id) =>
      '$baseUrl/simulator/payments/$id/confirm';
  static String simulatorPaymentFail(String id) =>
      '$baseUrl/simulator/payments/$id/fail';
  static String simulatorPaymentRefund(String id) =>
      '$baseUrl/simulator/payments/$id/refund';
  static String simulatorPaymentReverse(String id) =>
      '$baseUrl/simulator/payments/$id/reverse';

  // Profile
  static String get profile => '$baseUrl/auth/profile';
}
