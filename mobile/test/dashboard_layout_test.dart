import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:finpro_mobile/core/api/api_client.dart';
import 'package:finpro_mobile/core/auth/auth_notifier.dart';
import 'package:finpro_mobile/core/auth/auth_state.dart';
import 'package:finpro_mobile/core/models/user_model.dart';
import 'package:finpro_mobile/features/dashboard/dashboard_screen.dart';
import 'package:finpro_mobile/shared/widgets/skeleton_loader.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Fails every request immediately. `_isLoading` still starts `true`, so the
/// first frame — the one this test measures — always renders the loading
/// skeleton, but nothing is left in flight at the end of the test.
class _FailingAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async =>
      throw DioException(requestOptions: options, message: 'test-double');

  @override
  void close({bool force = false}) {}
}

/// Skips the real `checkAuthStatus()` so no plugin or network work happens.
class _StubAuth extends AuthNotifier {
  @override
  AuthState build() => AuthState.authenticated(
        UserModel(
          id: 'test-user',
          email: 'test@example.com',
          username: 'tester',
          firstName: 'Test',
          lastName: 'User',
        ),
      );
}

void main() {
  testWidgets(
    'dashboard loading skeleton scrolls instead of overflowing a short viewport',
    (tester) async {
      SharedPreferences.setMockInitialValues({});

      final originalAdapter = apiClient.dio.httpClientAdapter;
      apiClient.dio.httpClientAdapter = _FailingAdapter();
      addTearDown(() => apiClient.dio.httpClientAdapter = originalAdapter);

      // Regression: on a CPH2467 the dashboard's loading state reported
      // "A RenderFlex overflowed by 294 pixels on the bottom." The skeleton was
      // a fixed Column (~666px tall) sitting directly in the RefreshIndicator's
      // bounded body with no scroll ancestor, while the loaded branch scrolled.
      await tester.binding.setSurfaceSize(const Size(360, 420));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(
        ProviderScope(
          overrides: [authProvider.overrideWith(_StubAuth.new)],
          child: const MaterialApp(home: DashboardScreen()),
        ),
      );

      // Guard: we really are measuring the loading state, not the loaded one.
      expect(find.byType(SkeletonLoader), findsWidgets);

      expect(
        tester.takeException(),
        isNull,
        reason: 'the dashboard loading skeleton must not overflow its viewport',
      );

      // Let the failed request settle so no work is left pending.
      await tester.pump(const Duration(seconds: 1));
    },
  );
}
