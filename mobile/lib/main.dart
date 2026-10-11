import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app/app.dart';
import 'core/firebase/firebase_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize Firebase (gracefully degrades if google-services.json is placeholder)
  await FirebaseService.instance.initialize();

  // Catch all unhandled Flutter errors and send to Crashlytics
  FlutterError.onError = (errorDetails) {
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

  runApp(
    const ProviderScope(
      child: FinProMobileApp(),
    ),
  );
}
