import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:firebase_analytics/firebase_analytics.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:flutter/foundation.dart';

import '../../firebase_options.dart';
import '../api/api_client.dart';
import '../utils/app_log.dart';
import 'device_identity.dart';
import 'fcm_token_manager.dart';

/// Handles Firebase background notifications.
@pragma('vm:entry-point')
Future<void> _fcmBackgroundHandler(RemoteMessage message) async {
  if (Firebase.apps.isEmpty) {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
  }

  // Log only that a message arrived. Notification payloads can carry
  // transaction details, and message ids are not needed for support.
  logDebug('[FCM] Background message received.');
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
  StreamSubscription<String>? _tokenRefreshSubscription;

  /// Server + local push-token removal used during sign-out. The token provider
  /// and local deleter are injectable so the lifecycle can be unit-tested
  /// without touching Firebase plugins.
  late final FcmTokenManager _tokenManager = FcmTokenManager(
    client: apiClient,
    tokenProvider: () async {
      try {
        return await messaging.getToken();
      } catch (_) {
        return null;
      }
    },
    localTokenDeleter: () async {
      await _tokenRefreshSubscription?.cancel();
      _tokenRefreshSubscription = null;
      await messaging.deleteToken();
    },
  );

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
      } catch (_) {
        logDebug('[Firebase] Crashlytics setup failed.');
      }

      FirebaseMessaging.onBackgroundMessage(_fcmBackgroundHandler);

      try {
        await _setupFcm();
      } catch (_) {
        logDebug('[Firebase] FCM setup failed.');
      }

      logDebug('[Firebase] Initialized successfully');
    } catch (_) {
      logDebug('[Firebase] Initialization failed.');
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

  /// Authenticate using native Google Sign-In and return a verified identity token.
  /// Returns `null` if the user dismissed or cancelled the account picker.
  Future<String?> signInWithGoogle({GoogleSignIn? customGoogleSignIn}) async {
    try {
      final googleSignIn = customGoogleSignIn ??
          GoogleSignIn(
            serverClientId:
                '1024776311502-8jld09q86kqeei2ud56krp4kb2sht67l.apps.googleusercontent.com',
            scopes: ['email', 'profile'],
          );

      final GoogleSignInAccount? googleUser = await googleSignIn.signIn();
      if (googleUser == null) {
        logDebug('[GoogleAuth] User cancelled Google sign-in dialog.');
        return null;
      }

      final GoogleSignInAuthentication googleAuth =
          await googleUser.authentication;

      // Attempt Firebase credential sign-in if Firebase is active
      try {
        final OAuthCredential credential = GoogleAuthProvider.credential(
          accessToken: googleAuth.accessToken,
          idToken: googleAuth.idToken,
        );
        final userCredential = await auth.signInWithCredential(credential);
        final firebaseToken = await userCredential.user?.getIdToken();
        if (firebaseToken != null && firebaseToken.isNotEmpty) {
          return firebaseToken;
        }
      } catch (fbErr) {
        logDebug('[GoogleAuth] Firebase credential note: $fbErr');
      }

      // Fallback: return direct Google ID token
      if (googleAuth.idToken != null && googleAuth.idToken!.isNotEmpty) {
        return googleAuth.idToken;
      }

      throw Exception('Failed to retrieve authentication token from Google.');
    } catch (e, stackTrace) {
      recordError(e, stackTrace, reason: 'Google sign-in');
      rethrow;
    }
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

    logDebug('[FCM] Permission: ${settings.authorizationStatus}');

    FirebaseMessaging.onMessage.listen((RemoteMessage message) {
      // Notification payloads may contain transaction details; log only that
      // a message arrived rather than its title/body.
      logDebug('[FCM] Foreground message received.');
    });

    FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
      logDebug('[FCM] Opened from notification.');
      _handleNotificationNavigation(message.data);
    });

    final initialMessage = await messaging.getInitialMessage();

    if (initialMessage != null) {
      _handleNotificationNavigation(initialMessage.data);
    }

    _fcmConfigured = true;
  }

  void _handleNotificationNavigation(Map<String, dynamic> data) {
    // Never log the payload: notification data can carry account details.
    logDebug('[FCM] Notification navigation requested.');
  }

  /// Register the current FCM token with the FinPro backend.
  ///
  /// A stable per-install `deviceId` is sent with every registration so the
  /// backend upserts this device instead of replacing the user's other
  /// devices' tokens.
  Future<void> registerFcmToken() async {
    try {
      final token = await messaging.getToken();

      if (token == null) return;

      final deviceId = await DeviceIdentity.instance.getOrCreate();
      final platform = defaultTargetPlatform == TargetPlatform.iOS
          ? 'ios'
          : 'android';

      final registered = await _tokenManager.register(
        token: token,
        deviceId: deviceId,
        platform: platform,
      );

      if (!registered) {
        logDebug('[FCM] Token registration failed.');
        return;
      }

      logDebug('[FCM] Token registered with backend.');

      // Re-registering (login/register/offline retry) must replace the previous
      // listener instead of stacking a new one on every call.
      await _tokenRefreshSubscription?.cancel();
      _tokenRefreshSubscription = messaging.onTokenRefresh.listen((
        newToken,
      ) async {
        try {
          final currentDeviceId = await DeviceIdentity.instance.getOrCreate();
          await _tokenManager.register(
            token: newToken,
            deviceId: currentDeviceId,
            platform: platform,
          );
        } catch (_) {
          logDebug('[FCM] Token refresh registration failed.');
        }
      });
    } catch (_) {
      logDebug('[FCM] Token registration failed.');
    }
  }

  /// Removes this device's push token from the backend, then from the platform.
  ///
  /// Must run during sign-out while the access token is still valid. Every step
  /// is best-effort and time-bounded, so a failed or slow server call never
  /// blocks sign-out. Returns true when the backend acknowledged the removal.
  Future<bool> unregisterDeviceToken() => _tokenManager.unregister();

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
      await _tokenRefreshSubscription?.cancel();
      _tokenRefreshSubscription = null;
    } catch (_) {
      logDebug('[Firebase] Could not stop the token refresh listener.');
    }

    try {
      await auth.signOut();
    } catch (_) {
      // Local sign-out is the source of truth for the app session. Firebase
      // failures must not block clearing app tokens.
      logDebug('[Firebase] Firebase sign-out failed.');
    }

    try {
      await GoogleSignIn().signOut();
    } catch (_) {
      logDebug('[GoogleAuth] Google sign-out completed or not signed in.');
    }
  }
}
