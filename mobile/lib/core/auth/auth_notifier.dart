import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/api_client.dart';
import '../api/api_endpoints.dart';
import '../models/user_model.dart';
import '../firebase/firebase_service.dart';
import '../debug_agent_log.dart';
import 'auth_state.dart';
import 'token_storage.dart';

class AuthNotifier extends Notifier<AuthState> {
  @override
  AuthState build() {
    // Restore the persisted session asynchronously, after the initial
    // synchronous state has been produced.
    Future.microtask(checkAuthStatus);
    return AuthState.initial();
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
    } catch (_) {
      // Check cached user data for offline start
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
  }

  Future<bool> login(String email, String password) async {
    state = AuthState.loading();
    try {
      agentLog(
        location: 'auth_notifier.dart:login:entry',
        message: 'Login request starting',
        hypothesisId: 'A,B,E',
        data: {
          'url': ApiEndpoints.login,
          'emailLen': email.trim().length,
          'hasAt': email.contains('@'),
        },
      );
      final response = await apiClient.post(
        ApiEndpoints.login,
        data: {'email': email.trim(), 'password': password},
      );

      agentLog(
        location: 'auth_notifier.dart:login:response',
        message: 'Login HTTP response',
        hypothesisId: 'A,C',
        data: {
          'status': response.statusCode,
          'success': response.data is Map ? response.data['success'] : null,
          'hasUser': response.data is Map && response.data['data'] is Map
              ? response.data['data']['user'] != null
              : false,
          'dataType': response.data.runtimeType.toString(),
        },
      );

      if (response.statusCode == 200 && response.data['success'] == true) {
        final data = response.data['data'];
        final accessToken = data['accessToken'];
        final refreshToken = data['refreshToken'];
        final userJson = data['user'];
        final user = UserModel.fromJson(userJson);

        await TokenStorage.saveTokens(
          accessToken: accessToken,
          refreshToken: refreshToken ?? '',
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
        state = AuthState.unauthenticated(
          error: response.data['message'] ?? 'Login failed',
        );
        return false;
      }
    } catch (e) {
      agentLog(
        location: 'auth_notifier.dart:login:catch',
        message: 'Login threw',
        hypothesisId: 'A,B,C,D',
        data: _dioErrorData(e),
      );
      state = AuthState.unauthenticated(
        error: _extractErrorMessage(e, 'Invalid email or password. Please verify your credentials.'),
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
      agentLog(
        location: 'auth_notifier.dart:register:entry',
        message: 'Register request starting',
        hypothesisId: 'A,B,E',
        data: {
          'url': ApiEndpoints.register,
          'usernameLen': username.trim().length,
          'emailLen': email.trim().length,
          'passwordLen': password.length,
          'hasAt': email.contains('@'),
        },
      );
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

      agentLog(
        location: 'auth_notifier.dart:register:response',
        message: 'Register HTTP response',
        hypothesisId: 'A,C',
        data: {
          'status': response.statusCode,
          'success': response.data is Map ? response.data['success'] : null,
          'hasUser': response.data is Map && response.data['data'] is Map
              ? response.data['data']['user'] != null
              : false,
          'dataType': response.data.runtimeType.toString(),
        },
      );

      if (response.statusCode == 201 && response.data['success'] == true) {
        final data = response.data['data'];
        final accessToken = data['accessToken'];
        final refreshToken = data['refreshToken'];
        final user = UserModel.fromJson(data['user']);

        await TokenStorage.saveTokens(
          accessToken: accessToken,
          refreshToken: refreshToken ?? '',
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
      agentLog(
        location: 'auth_notifier.dart:register:catch',
        message: 'Register threw',
        hypothesisId: 'A,B,C,D',
        data: _dioErrorData(e),
      );
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
        if (error is Map && error['message'] != null && error['message'].toString().isNotEmpty) {
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

  Map<String, dynamic> _dioErrorData(Object e) {
    if (e is DioException) {
      final data = e.response?.data;
      final errorObj = data is Map ? data['error'] : null;
      return {
        'type': e.type.toString(),
        'status': e.response?.statusCode,
        'path': e.requestOptions.path,
        'errorCode': errorObj is Map ? errorObj['code'] : null,
        'errorMessage': errorObj is Map ? errorObj['message'] : null,
        'messageKey': data is Map ? data['message'] : null,
        'dioMessage': e.message,
      };
    }
    return {'type': e.runtimeType.toString(), 'toString': e.toString()};
  }

  Future<void> logout() async {
    try {
      final refreshToken = await TokenStorage.getRefreshToken();
      if (refreshToken != null) {
        await apiClient.post(
          ApiEndpoints.logout,
          data: {'refreshToken': refreshToken},
        );
      }
    } catch (_) {}
    // Sign out of Firebase
    await FirebaseService.instance.signOut();
    await TokenStorage.clearAll();
    state = AuthState.unauthenticated();
  }
}

final authProvider = NotifierProvider<AuthNotifier, AuthState>(
  AuthNotifier.new,
);
