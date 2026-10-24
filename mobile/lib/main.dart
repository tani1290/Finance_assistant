import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app/app.dart';
import 'app/configuration_error_app.dart';
import 'core/api/api_endpoints.dart';
import 'core/config/app_environment.dart';
import 'core/firebase/firebase_service.dart';
import 'core/utils/app_log.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Resolve and validate the backend URL before anything can issue a request.
  // A missing or unsafe configuration must fail loudly instead of silently
  // talking to production or an unknown host.
  try {
    ApiEndpoints.baseUrl = AppEnvironment.resolve();
  } on ApiConfigurationException catch (error) {
    runApp(ConfigurationErrorApp(message: error.message));
    return;
  }

  // Firebase is optional for the core finance flows. A missing/placeholder
  // configuration or a platform failure must never prevent the app from
  // starting, so initialization is best-effort and contained.
  try {
    await FirebaseService.instance.initialize();
  } catch (_) {
    logDebug('[Startup] Firebase unavailable, continuing without it.');
  }

  // Catch all unhandled Flutter errors and send to Crashlytics. Keep the
  // default presentation so debug builds still show the error and stack.
  FlutterError.onError = (errorDetails) {
    FlutterError.presentError(errorDetails);
    FirebaseService.instance.recordError(
      errorDetails.exception,
      errorDetails.stack,
      reason: 'FlutterError',
    );
  };

  // Set system UI overlay style
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Color(0xFF131C31),
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );

  runApp(const ProviderScope(child: FinProMobileApp()));
}
