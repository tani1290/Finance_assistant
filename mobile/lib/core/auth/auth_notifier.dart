import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/api_client.dart';
import '../api/api_endpoints.dart';
import '../models/user_model.dart';
import '../firebase/firebase_service.dart';
import 'auth_state.dart';
import 'session_events.dart';
import 'token_storage.dart';

class AuthNotifier extends Notifier<AuthState> {
  @override
  AuthState build() {
    // Restore the persisted session asynchronously, after the initial
    // synchronous state has been produced.
    Future.microtask(checkAuthStatus);

    sessionExpiredNotifier.addListener(_handleSessionExpired);
    ref.onDispose(
      () => sessionExpiredNotifier.removeListener(_handleSessionExpired),
    );

    return AuthState.initial();
  }

  void _handleSessionExpired() {
    if (state.status == AuthStatus.unauthenticated) return;
    state = AuthState.unauthenticated(
      error: 'Your session expired. Please sign in again.',
    );
  }

  Future<void> checkAuthStatus() async {
    final token = await TokenStorage.getAccessToken();
    if (token == null) {
      state = AuthState.unauthenticated();
      return;
    }

    try {
      final response = await apiClient.get(ApiEndpoints.me);
      if (response.statusCode == 200 && response.data['success'] == true) {
        final user = UserModel.fromJson(response.data['data']);
        state = AuthState.authenticated(user);
        // Register FCM token now that we know the user is logged in
        FirebaseService.instance.registerFcmToken();
        FirebaseService.instance.setUserId(user.id);
      } else {
        await TokenStorage.clearAll();
        state = AuthState.unauthenticated();
      }
    } on DioException catch (e) {
      final statusCode = e.response?.statusCode;
      if (statusCode == 401 || statusCode == 403) {
        // The token is no longer accepted (and refresh already failed inside
        // the API client). Do not resurrect a tokenless "authenticated" state.
        await TokenStorage.clearAll();
        state = AuthState.unauthenticated();
        return;
      }

      // Genuine connectivity failure: allow an offline start with the cached
      // user so the shell can render already-synced data.
      await _restoreCachedUser();
    } catch (_) {
      await _restoreCachedUser();
    }
  }

  Future<void> _restoreCachedUser() async {
    final cached = await TokenStorage.getUserData();
    if (cached['email'] != null && cached['userId'] != null) {
      final fallbackUser = UserModel(
        id: cached['userId']!,
        email: cached['email']!,
        username: cached['name'] ?? 'User',
        firstName: cached['name'] ?? '',
        lastName: '',
      );
      state = AuthState.authenticated(fallbackUser);
    } else {
      state = AuthState.unauthenticated();
    }
  }

  Future<bool> login(String email, String password) async {
    state = AuthState.loading();
    try {
      final response = await apiClient.post(
        ApiEndpoints.login,
        data: {'email': email.trim(), 'password': password},
      );

      if (response.statusCode == 200 && response.data['success'] == true) {
        final data = response.data['data'];
        if (data is! Map) {
          state = AuthState.unauthenticated(
            error: 'The server returned an invalid sign-in response.',
          );
          return false;
        }
        final accessToken = data['accessToken'];
        final refreshToken = data['refreshToken'];
        final userJson = data['user'];
        if (accessToken is! String ||
            accessToken.isEmpty ||
            refreshToken is! String ||
            refreshToken.isEmpty ||
            userJson is! Map) {
          state = AuthState.unauthenticated(
            error: 'The server returned an invalid sign-in response.',
          );
          return false;
        }

        final user = UserModel.fromJson(Map<String, dynamic>.from(userJson));

        await TokenStorage.saveTokens(
          accessToken: accessToken,
          refreshToken: refreshToken,
          userId: user.id,
          email: user.email,
          name: user.fullName,
        );

        state = AuthState.authenticated(user);

        // Firebase: register FCM token + analytics + set user ID
        FirebaseService.instance.registerFcmToken();
        FirebaseService.instance.setUserId(user.id);
        FirebaseService.instance.logLogin(method: 'email');

        return true;
      } else {
        final message = response.data is Map
            ? (response.data['error'] is Map
                  ? response.data['error']['message']
                  : response.data['message'])
            : null;
        state = AuthState.unauthenticated(
          error: message?.toString() ?? 'Login failed',
        );
        return false;
      }
    } catch (e) {
      state = AuthState.unauthenticated(
        error: _extractErrorMessage(
          e,
          'Invalid email or password. Please verify your credentials.',
        ),
      );
      return false;
    }
  }

  Future<bool> register({
    required String username,
    required String email,
    required String password,
    String firstName = '',
    String lastName = '',
  }) async {
    state = AuthState.loading();
    try {
      final response = await apiClient.post(
        ApiEndpoints.register,
        data: {
          'username': username.trim(),
          'email': email.trim(),
          'password': password,
          'firstName': firstName.trim(),
          'lastName': lastName.trim(),
        },
      );

      if (response.statusCode == 201 && response.data['success'] == true) {
        final data = response.data['data'];
        if (data is! Map) {
          state = AuthState.unauthenticated(
            error: 'The server returned an invalid registration response.',
          );
          return false;
        }
        final accessToken = data['accessToken'];
        final refreshToken = data['refreshToken'];
        final userJson = data['user'];
        if (accessToken is! String ||
            accessToken.isEmpty ||
            refreshToken is! String ||
            refreshToken.isEmpty ||
            userJson is! Map) {
          state = AuthState.unauthenticated(
            error: 'The server returned an invalid registration response.',
          );
          return false;
        }

        final user = UserModel.fromJson(Map<String, dynamic>.from(userJson));

        await TokenStorage.saveTokens(
          accessToken: accessToken,
          refreshToken: refreshToken,
          userId: user.id,
          email: user.email,
          name: user.fullName,
        );

        state = AuthState.authenticated(user);

        // Firebase post-register hooks
        FirebaseService.instance.registerFcmToken();
        FirebaseService.instance.setUserId(user.id);
        FirebaseService.instance.logSignUp(method: 'email');

        return true;
      } else {
        state = AuthState.unauthenticated(
          error: response.data['message'] ?? 'Registration failed',
        );
        return false;
      }
    } catch (e) {
      state = AuthState.unauthenticated(
        error: _extractErrorMessage(
          e,
          'Registration failed. Username or email may already be registered.',
        ),
      );
      return false;
    }
  }

  String _extractErrorMessage(Object e, String fallback) {
    if (e is DioException) {
      if (e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.sendTimeout ||
          e.type == DioExceptionType.receiveTimeout) {
        return 'Connection timed out. Please check your internet connection.';
      }
      if (e.type == DioExceptionType.connectionError) {
        return 'Unable to reach FinPro server. Please check your internet connection.';
      }
      if (e.response?.statusCode == 429) {
        return 'Too many attempts. Please try again in 15 minutes.';
      }
      final data = e.response?.data;
      if (data is Map) {
        final error = data['error'];
        if (error is Map &&
            error['message'] != null &&
            error['message'].toString().isNotEmpty) {
          final msg = error['message'].toString();
          if (msg != 'An internal server error occurred.') return msg;
        }
        if (data['message'] != null && data['message'].toString().isNotEmpty) {
          final msg = data['message'].toString();
          if (msg != 'An internal server error occurred.') return msg;
        }
      }
      if (e.response?.statusCode == 401) {
        return 'Invalid email/username or password.';
      }
      if (e.response?.statusCode == 409) {
        return 'An account with this email or username already exists.';
      }
      if (e.response?.statusCode == 400) {
        return 'Please ensure all fields are filled and password is at least 8 characters.';
      }
    }
    return fallback;
  }

  /// Replaces the cached user for the current session after a successful
  /// profile update so the shell and settings reflect the new identity without
  /// a full sign-out. No-op when the session is not authenticated.
  void updateUser(UserModel user) {
    if (state.status != AuthStatus.authenticated) return;
    state = AuthState.authenticated(user);
  }

  Future<void> logout() async {
    // Unregister this device's push token first, while the access token is
    // still valid. The manager bounds each step, so an unreachable backend
    // cannot stall sign-out.
    try {
      await FirebaseService.instance.unregisterDeviceToken();
    } catch (_) {
      // Push cleanup is best-effort; it must never block sign-out.
    }

    try {
      final refreshToken = await TokenStorage.getRefreshToken();
      if (refreshToken != null) {
        await apiClient.post(
          ApiEndpoints.logout,
          data: {'refreshToken': refreshToken},
        );
      }
    } catch (_) {
      // Server-side revocation is best-effort; local sign-out must still win.
    }

    try {
      await FirebaseService.instance.signOut();
    } catch (_) {}

    try {
      await TokenStorage.clearAll();
    } finally {
      state = AuthState.unauthenticated();
    }
  }
}

final authProvider = NotifierProvider<AuthNotifier, AuthState>(
  AuthNotifier.new,
);
