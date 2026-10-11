import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/api_client.dart';
import '../api/api_endpoints.dart';
import '../models/user_model.dart';
import '../firebase/firebase_service.dart';
import 'auth_state.dart';
import 'token_storage.dart';

class AuthNotifier extends StateNotifier<AuthState> {
  AuthNotifier() : super(AuthState.initial()) {
    checkAuthStatus();
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
      final response = await apiClient.post(
        ApiEndpoints.login,
        data: {'email': email.trim(), 'password': password},
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
      state = AuthState.unauthenticated(
        error: 'Invalid email or password. Please verify your credentials.',
      );
      return false;
    }
  }

  /// Google Sign-In via Firebase Auth → FinPro backend JWT
  Future<bool> loginWithGoogle() async {
    state = AuthState.loading();
    try {
      final data = await FirebaseService.instance.signInWithGoogle();
      if (data == null) {
        state = AuthState.unauthenticated(error: 'Google Sign-In was cancelled.');
        return false;
      }

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

      // Firebase post-login hooks
      FirebaseService.instance.registerFcmToken();
      FirebaseService.instance.setUserId(user.id);
      FirebaseService.instance.logLogin(method: 'google');

      return true;
    } catch (e) {
      state = AuthState.unauthenticated(error: 'Google Sign-In failed. Please try again.');
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
      state = AuthState.unauthenticated(
        error: 'Registration failed. Username or email may already be registered.',
      );
      return false;
    }
  }

  Future<void> logout() async {
    try {
      final refreshToken = await TokenStorage.getRefreshToken();
      if (refreshToken != null) {
        await apiClient.post(ApiEndpoints.logout, data: {'refreshToken': refreshToken});
      }
    } catch (_) {}
    // Sign out of Firebase + Google
    await FirebaseService.instance.signOut();
    await TokenStorage.clearAll();
    state = AuthState.unauthenticated();
  }
}

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier();
});
