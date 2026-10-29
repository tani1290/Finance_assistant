import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:finpro_mobile/core/api/api_client.dart';
import 'package:finpro_mobile/core/api/api_endpoints.dart';
import 'package:finpro_mobile/core/auth/auth_notifier.dart';
import 'package:finpro_mobile/core/auth/auth_state.dart';
import 'package:finpro_mobile/core/auth/token_storage.dart';
import 'package:finpro_mobile/features/auth/login_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _MockGoogleAuthAdapter implements HttpClientAdapter {
  _MockGoogleAuthAdapter({required this.statusCode, required this.payload});

  final int statusCode;
  final Map<String, dynamic> payload;
  RequestOptions? lastRequest;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    lastRequest = options;
    return ResponseBody.fromString(
      jsonEncode(payload),
      statusCode,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    TokenStorage.resetSecureStoreForTesting();
    TokenStorage.resetSessionCacheForTesting();
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
    await TokenStorage.clearAll();
  });

  group('Google Auth Contract & Endpoints', () {
    test('ApiEndpoints.googleAuth points to /auth/google', () {
      expect(ApiEndpoints.googleAuth, endsWith('/auth/google'));
    });
  });

  group('LoginScreen Google Sign-In UI', () {
    testWidgets('renders OR divider and Continue with Google button', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: LoginScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('OR'), findsOneWidget);
      expect(find.text('Continue with Google'), findsOneWidget);
      expect(find.byType(OutlinedButton), findsOneWidget);
    });
  });

  group('AuthNotifier Google Sign-In Flow', () {
    test('loginWithGoogle with explicitIdToken succeeds and stores tokens', () async {
      final adapter = _MockGoogleAuthAdapter(
        statusCode: 200,
        payload: {
          'success': true,
          'message': 'Google authentication successful',
          'data': {
            'accessToken': 'test-access-token-123',
            'refreshToken': 'test-refresh-token-456',
            'user': {
              'id': 'usr-google-1',
              'email': 'user@example.com',
              'username': 'testuser',
              'firstName': 'Test',
              'lastName': 'User',
            },
          },
        },
      );

      final originalAdapter = apiClient.dio.httpClientAdapter;
      addTearDown(() => apiClient.dio.httpClientAdapter = originalAdapter);
      apiClient.dio.httpClientAdapter = adapter;

      final container = ProviderContainer();
      addTearDown(container.dispose);

      final notifier = container.read(authProvider.notifier);
      final success = await notifier.loginWithGoogle(explicitIdToken: 'sample-id-token');

      expect(success, isTrue);
      expect(adapter.lastRequest, isNotNull);
      expect(adapter.lastRequest!.path, endsWith('/auth/google'));
      expect(adapter.lastRequest!.data, containsPair('idToken', 'sample-id-token'));

      final state = container.read(authProvider);
      expect(state.status, AuthStatus.authenticated);
      expect(state.user, isNotNull);
      expect(state.user!.email, 'user@example.com');
      expect(state.user!.firstName, 'Test');

      // Verify token storage
      final storedAccess = await TokenStorage.getAccessToken();
      expect(storedAccess, 'test-access-token-123');
    });

    test('loginWithGoogle with backend failure sets error state', () async {
      final adapter = _MockGoogleAuthAdapter(
        statusCode: 401,
        payload: {
          'success': false,
          'message': 'Invalid or expired Google token',
        },
      );

      final originalAdapter = apiClient.dio.httpClientAdapter;
      addTearDown(() => apiClient.dio.httpClientAdapter = originalAdapter);
      apiClient.dio.httpClientAdapter = adapter;

      final container = ProviderContainer();
      addTearDown(container.dispose);

      final notifier = container.read(authProvider.notifier);
      final success = await notifier.loginWithGoogle(explicitIdToken: 'bad-token');

      expect(success, isFalse);
      final state = container.read(authProvider);
      expect(state.status, AuthStatus.unauthenticated);
      expect(state.errorMessage, contains('Invalid or expired Google token'));
    });
  });
}
