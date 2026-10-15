import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:firebase_analytics/firebase_analytics.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';

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
/// - Google Sign-In
/// - Email/password authentication
/// - Phone OTP authentication
/// - Firebase Messaging
/// - Analytics and Crashlytics
class FirebaseService {
  FirebaseService._();

  static final FirebaseService instance = FirebaseService._();

  FirebaseAuth get auth => FirebaseAuth.instance;

  FirebaseMessaging get messaging => FirebaseMessaging.instance;

  FirebaseAnalytics get analytics => FirebaseAnalytics.instance;

  FirebaseCrashlytics get crashlytics => FirebaseCrashlytics.instance;

  final GoogleSignIn _googleSignIn = GoogleSignIn.instance;

  bool _initialized = false;
  bool _googleSignInInitialized = false;
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
  // Google Sign-In
  // ---------------------------------------------------------------------------

  Future<void> _initializeGoogleSignIn() async {
    if (_googleSignInInitialized) return;

    await _googleSignIn.initialize(
      serverClientId:
          '1024776311502-8jld09q86kqeei2ud56krp4kb2sht67l.apps.googleusercontent.com',
    );

    _googleSignInInitialized = true;
  }

  /// Authenticate with Google, then exchange credentials with the FinPro backend.
  ///
  /// Returns the backend response data, or null if the user cancels.
  Future<Map<String, dynamic>?> signInWithGoogle() async {
    try {
      await initialize();
      await _initializeGoogleSignIn();

      final googleUser = await _googleSignIn.authenticate();

      final googleAuth = googleUser.authentication;
      final googleIdToken = googleAuth.idToken;

      if (googleIdToken == null) {
        throw Exception(
          'Google did not return an ID token. '
          'Check your OAuth client configuration.',
        );
      }

      final credential = GoogleAuthProvider.credential(idToken: googleIdToken);

      final userCredential = await auth.signInWithCredential(credential);

      final firebaseUser = userCredential.user;

      if (firebaseUser == null) {
        throw Exception('Firebase did not return an authenticated user.');
      }

      final firebaseIdToken = await firebaseUser.getIdToken();

      if (firebaseIdToken == null) {
        throw Exception('Firebase did not return an ID token.');
      }

      final displayName = (googleUser.displayName ?? '').trim();

      final nameParts = displayName.isEmpty
          ? <String>[]
          : displayName.split(RegExp(r'\s+'));

      final firstName = nameParts.isNotEmpty ? nameParts.first : '';
      final lastName = nameParts.length > 1
          ? nameParts.sublist(1).join(' ')
          : '';

      final response = await apiClient.post(
        ApiEndpoints.googleToken,
        data: {
          // Preserve the existing backend request contract.
          'token': googleIdToken,
          'idToken': googleIdToken,
          'firebaseToken': firebaseIdToken,
          'email': firebaseUser.email,
          'firstName': firstName,
          'lastName': lastName,
          'avatarUrl': firebaseUser.photoURL ?? googleUser.photoUrl,
          'googleId': googleUser.id,
        },
      );

      if (response.statusCode == 200 && response.data['success'] == true) {
        await logLogin(method: 'google');

        return Map<String, dynamic>.from(response.data['data'] as Map);
      }

      throw Exception(
        'FinPro backend rejected Google authentication: '
        '${response.statusCode}',
      );
    } catch (e, stackTrace) {
      debugPrint('[Firebase] Google Sign-In failed: $e');

      recordError(e, stackTrace, reason: 'Google Sign-In');

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
  // Phone Number / SMS OTP Authentication
  // ---------------------------------------------------------------------------

  /// Request an SMS verification code.
  ///
  /// Provide the callbacks from your phone verification screen.
  /// Phone numbers must include the country code, e.g. +919876543210.
  Future<void> verifyPhoneNumber({
    required String phoneNumber,
    required void Function(String verificationId) onCodeSent,
    required void Function(String error) onError,
    void Function(UserCredential credential)? onAutoVerified,
    int? resendToken,
  }) async {
    try {
      await auth.verifyPhoneNumber(
        phoneNumber: phoneNumber,
        forceResendingToken: resendToken,

        verificationCompleted: (PhoneAuthCredential credential) async {
          try {
            final userCredential = await auth.signInWithCredential(credential);

            await logLogin(method: 'phone');

            onAutoVerified?.call(userCredential);
          } catch (e, stackTrace) {
            recordError(e, stackTrace, reason: 'Automatic phone verification');
            onError(e.toString());
          }
        },

        verificationFailed: (FirebaseAuthException e) {
          debugPrint('[Firebase] Phone verification failed: ${e.code}');
          onError(e.message ?? 'Phone verification failed.');
        },

        codeSent: (String verificationId, int? newResendToken) {
          onCodeSent(verificationId);
        },

        codeAutoRetrievalTimeout: (String verificationId) {
          debugPrint('[Firebase] OTP auto-retrieval timed out.');
        },
      );
    } catch (e, stackTrace) {
      recordError(e, stackTrace, reason: 'Request phone OTP');
      rethrow;
    }
  }

  /// Verify an OTP entered by the user.
  Future<UserCredential> verifyPhoneOtp({
    required String verificationId,
    required String smsCode,
  }) async {
    try {
      final credential = PhoneAuthProvider.credential(
        verificationId: verificationId,
        smsCode: smsCode,
      );

      final userCredential = await auth.signInWithCredential(credential);

      await logLogin(method: 'phone');

      return userCredential;
    } catch (e, stackTrace) {
      recordError(e, stackTrace, reason: 'Verify phone OTP');
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
      await _googleSignIn.signOut();
    } catch (e) {
      debugPrint('[Firebase] Google sign-out failed: $e');
    }

    try {
      await auth.signOut();
    } catch (e) {
      debugPrint('[Firebase] Firebase sign-out failed: $e');
      rethrow;
    }
  }
}
