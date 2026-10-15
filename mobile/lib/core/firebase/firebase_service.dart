import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:firebase_analytics/firebase_analytics.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:flutter/foundation.dart';

import '../../firebase_options.dart';
import '../api/api_client.dart';
import '../api/api_endpoints.dart';

/// Handles Firebase background notifications.
@pragma('vm:entry-point')
Future<void> _fcmBackgroundHandler(RemoteMessage message) async {
  if (Firebase.apps.isEmpty) {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
  }

  debugPrint('[FCM] Background message: ${message.messageId}');
}

/// Firebase integration for FinPro Mobile.
///
/// Handles:
/// - Firebase initialization
/// - Email/password authentication
/// - Firebase Messaging
/// - Analytics and Crashlytics
class FirebaseService {
  FirebaseService._();

  static final FirebaseService instance = FirebaseService._();

  FirebaseAuth get auth => FirebaseAuth.instance;

  FirebaseMessaging get messaging => FirebaseMessaging.instance;

  FirebaseAnalytics get analytics => FirebaseAnalytics.instance;

  FirebaseCrashlytics get crashlytics => FirebaseCrashlytics.instance;

  bool _initialized = false;
  bool _fcmConfigured = false;

  /// Initialize Firebase before runApp().
  Future<void> initialize() async {
    if (_initialized) return;

    try {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp(
          options: DefaultFirebaseOptions.currentPlatform,
        );
      }

      _initialized = true;

      try {
        await crashlytics.setCrashlyticsCollectionEnabled(!kDebugMode);

        FlutterError.onError = (errorDetails) {
          recordError(
            errorDetails.exception,
            errorDetails.stack,
            reason: 'FlutterError',
          );
        };
      } catch (e) {
        debugPrint('[Firebase] Crashlytics setup failed: $e');
      }

      FirebaseMessaging.onBackgroundMessage(_fcmBackgroundHandler);

      try {
        await _setupFcm();
      } catch (e) {
        debugPrint('[Firebase] FCM setup failed: $e');
      }

      debugPrint('[Firebase] Initialized successfully');
    } catch (e, stackTrace) {
      debugPrint('[Firebase] Initialization failed: $e');
      debugPrintStack(stackTrace: stackTrace);
      rethrow;
    }
  }

  // ---------------------------------------------------------------------------
  // Email and Password Authentication
  // ---------------------------------------------------------------------------

  /// Register an account with Firebase.
  ///
  /// This creates a Firebase account. It does not automatically create
  /// the corresponding FinPro backend account.
  Future<UserCredential> registerWithEmail({
    required String email,
    required String password,
  }) async {
    try {
      final credential = await auth.createUserWithEmailAndPassword(
        email: email.trim(),
        password: password,
      );

      await logSignUp(method: 'email');

      return credential;
    } catch (e, stackTrace) {
      recordError(e, stackTrace, reason: 'Email registration');
      rethrow;
    }
  }

  /// Sign in using email and password.
  Future<UserCredential> signInWithEmail({
    required String email,
    required String password,
  }) async {
    try {
      final credential = await auth.signInWithEmailAndPassword(
        email: email.trim(),
        password: password,
      );

      await logLogin(method: 'email');

      return credential;
    } catch (e, stackTrace) {
      recordError(e, stackTrace, reason: 'Email sign-in');
      rethrow;
    }
  }

  /// Send an email verification link to the currently signed-in user.
  Future<void> sendEmailVerification() async {
    final user = auth.currentUser;

    if (user == null) {
      throw Exception('No signed-in user.');
    }

    if (!user.emailVerified) {
      await user.sendEmailVerification();
    }
  }

  /// Send a password reset email.
  Future<void> sendPasswordResetEmail({required String email}) async {
    await auth.sendPasswordResetEmail(email: email.trim());
  }

  // ---------------------------------------------------------------------------
  // Firebase Messaging
  // ---------------------------------------------------------------------------

  Future<void> _setupFcm() async {
    if (_fcmConfigured) return;

    final settings = await messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );

    debugPrint('[FCM] Permission: ${settings.authorizationStatus}');

    FirebaseMessaging.onMessage.listen((RemoteMessage message) {
      debugPrint('[FCM] Foreground message: ${message.notification?.title}');
    });

    FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
      debugPrint('[FCM] Opened from notification: ${message.data}');
      _handleNotificationNavigation(message.data);
    });

    final initialMessage = await messaging.getInitialMessage();

    if (initialMessage != null) {
      _handleNotificationNavigation(initialMessage.data);
    }

    _fcmConfigured = true;
  }

  void _handleNotificationNavigation(Map<String, dynamic> data) {
    final screen = data['screen'];
    debugPrint('[FCM] Navigate to: $screen');
  }

  /// Register the current FCM token with the FinPro backend.
  Future<void> registerFcmToken() async {
    try {
      final token = await messaging.getToken();

      if (token == null) return;

      await apiClient.post(
        ApiEndpoints.fcmToken,
        data: {'fcmToken': token, 'platform': defaultTargetPlatform.name},
      );

      debugPrint('[FCM] Token registered with backend');

      messaging.onTokenRefresh.listen((newToken) async {
        try {
          await apiClient.post(
            ApiEndpoints.fcmToken,
            data: {
              'fcmToken': newToken,
              'platform': defaultTargetPlatform.name,
            },
          );
        } catch (e) {
          debugPrint('[FCM] Token refresh registration failed: $e');
        }
      });
    } catch (e) {
      debugPrint('[FCM] Token registration failed: $e');
    }
  }

  // ---------------------------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------------------------

  Future<void> logLogin({String method = 'email'}) async {
    try {
      await analytics.logLogin(loginMethod: method);
    } catch (_) {}
  }

  Future<void> logSignUp({String method = 'email'}) async {
    try {
      await analytics.logSignUp(signUpMethod: method);
    } catch (_) {}
  }

  Future<void> logEvent(String name, {Map<String, Object>? params}) async {
    try {
      await analytics.logEvent(name: name, parameters: params);
    } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Crashlytics
  // ---------------------------------------------------------------------------

  void recordError(dynamic error, StackTrace? stack, {String? reason}) {
    try {
      crashlytics.recordError(error, stack, reason: reason, fatal: false);
    } catch (_) {}
  }

  Future<void> setUserId(String userId) async {
    try {
      await crashlytics.setUserIdentifier(userId);
      await analytics.setUserId(id: userId);
    } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Sign Out
  // ---------------------------------------------------------------------------

  Future<void> signOut() async {
    try {
      await auth.signOut();
    } catch (e) {
      debugPrint('[Firebase] Firebase sign-out failed: $e');
      rethrow;
    }
  }
}
