import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:firebase_analytics/firebase_analytics.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';
import '../api/api_client.dart';
import '../api/api_endpoints.dart';

// Background message handler (top-level function required by FCM)
@pragma('vm:entry-point')
Future<void> _fcmBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
  debugPrint('[FCM] Background message: ${message.messageId}');
}

/// Firebase Service for FinPro Mobile
///
/// Handles Firebase initialization, Auth (Google Sign-In),
/// FCM token management, Crashlytics, and Analytics.
class FirebaseService {
  FirebaseService._();
  static final FirebaseService instance = FirebaseService._();

  FirebaseAuth get auth => FirebaseAuth.instance;
  FirebaseMessaging get messaging => FirebaseMessaging.instance;
  FirebaseAnalytics get analytics => FirebaseAnalytics.instance;
  FirebaseCrashlytics get crashlytics => FirebaseCrashlytics.instance;

  bool _initialized = false;

  /// Initialize Firebase — call once from main() before runApp().
  Future<void> initialize() async {
    if (_initialized) return;
    try {
      await Firebase.initializeApp();

      // Crashlytics — collect crashes in release only
      await crashlytics.setCrashlyticsCollectionEnabled(!kDebugMode);
      FlutterError.onError = crashlytics.recordFlutterFatalError;

      // FCM background handler
      FirebaseMessaging.onBackgroundMessage(_fcmBackgroundHandler);

      await _setupFcm();

      _initialized = true;
      debugPrint('[Firebase] Initialized ✓');
    } catch (e) {
      debugPrint('[Firebase] Init skipped (no google-services.json): $e');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FCM Setup
  // ──────────────────────────────────────────────────────────────────────────

  Future<void> _setupFcm() async {
    // Request permission (needed for iOS, no-op on Android 12-)
    final settings = await messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );
    debugPrint('[FCM] Permission: ${settings.authorizationStatus}');

    // Foreground messages
    FirebaseMessaging.onMessage.listen((RemoteMessage message) {
      debugPrint('[FCM] Foreground: ${message.notification?.title}');
    });

    // App opened from notification
    FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
      debugPrint('[FCM] Opened from notification: ${message.data}');
      _handleNotificationNavigation(message.data);
    });

    // Check if app was opened from a terminated state via notification
    final initialMessage = await messaging.getInitialMessage();
    if (initialMessage != null) {
      _handleNotificationNavigation(initialMessage.data);
    }
  }

  void _handleNotificationNavigation(Map<String, dynamic> data) {
    final screen = data['screen'];
    debugPrint('[FCM] Navigate to: $screen');
  }

  /// Get the current FCM token and register it with the FinPro backend.
  Future<void> registerFcmToken() async {
    try {
      final token = await messaging.getToken();
      if (token == null) return;
      debugPrint('[FCM] Token: ${token.substring(0, 20)}…');
      await apiClient.post(
        ApiEndpoints.fcmToken,
        data: {'fcmToken': token, 'platform': 'android'},
      );
      debugPrint('[FCM] Token registered with backend ✓');

      // Listen for token refresh
      messaging.onTokenRefresh.listen((newToken) {
        apiClient.post(
          ApiEndpoints.fcmToken,
          data: {'fcmToken': newToken, 'platform': 'android'},
        );
      });
    } catch (e) {
      debugPrint('[FCM] Token registration failed: $e');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Google Sign-In
  // ──────────────────────────────────────────────────────────────────────────

  /// Perform Google Sign-In and return { user, accessToken, refreshToken } from FinPro backend.
  Future<Map<String, dynamic>?> signInWithGoogle() async {
    try {
      final googleSignIn = GoogleSignIn(
        scopes: ['email', 'profile'],
        // Web client ID so Android returns a Google ID token the backend can verify
        serverClientId:
            '1024776311502-8jld09q86kqeei2ud56krp4kb2sht67l.apps.googleusercontent.com',
      );
      final googleUser = await googleSignIn.signIn();
      if (googleUser == null) return null; // user cancelled

      final googleAuth = await googleUser.authentication;
      final googleIdToken = googleAuth.idToken;

      // Authenticate with Firebase on device
      String? firebaseIdToken;
      if (googleIdToken != null) {
        final credential = GoogleAuthProvider.credential(
          accessToken: googleAuth.accessToken,
          idToken: googleIdToken,
        );
        final userCredential = await auth.signInWithCredential(credential);
        firebaseIdToken = await userCredential.user?.getIdToken();
      }
      firebaseIdToken ??= await auth.currentUser?.getIdToken();

      final parts = (googleUser.displayName ?? '').trim().split(' ');
      final firstName = parts.isNotEmpty ? parts.first : '';
      final lastName = parts.length > 1 ? parts.sublist(1).join(' ') : '';

      // Backend expects `token` (frontend contract). Also send `idToken`, `firebaseToken`, and metadata.
      final response = await apiClient.post(
        ApiEndpoints.googleToken,
        data: {
          'token': googleIdToken ?? firebaseIdToken,
          'idToken': googleIdToken ?? firebaseIdToken,
          'firebaseToken': firebaseIdToken,
          'email': googleUser.email,
          'firstName': firstName,
          'lastName': lastName,
          'avatarUrl': googleUser.photoUrl,
          'googleId': auth.currentUser?.uid,
        },
      );

      if (response.statusCode == 200 && response.data['success'] == true) {
        return response.data['data'] as Map<String, dynamic>;
      }
      throw Exception('Google token exchange failed');
    } catch (e) {
      debugPrint('[Firebase] Google Sign-In failed: $e');
      crashlytics.recordError(e, StackTrace.current, reason: 'Google Sign-In');
      rethrow;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Analytics
  // ──────────────────────────────────────────────────────────────────────────

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

  // ──────────────────────────────────────────────────────────────────────────
  // Crashlytics helpers
  // ──────────────────────────────────────────────────────────────────────────

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

  Future<void> signOut() async {
    try {
      await GoogleSignIn().signOut();
      await auth.signOut();
    } catch (_) {}
  }
}
