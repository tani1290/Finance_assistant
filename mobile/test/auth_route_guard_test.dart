import 'package:finpro_mobile/app/auth_route_guard.dart';
import 'package:finpro_mobile/app/router.dart';
import 'package:finpro_mobile/core/auth/auth_notifier.dart';
import 'package:finpro_mobile/core/auth/auth_state.dart';
import 'package:finpro_mobile/features/auth/login_screen.dart';
import 'package:finpro_mobile/features/settings/settings_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// A guard stub that skips session restoration entirely so the test drives the
/// status deterministically.
class _StubUnauthenticatedAuth extends AuthNotifier {
  @override
  AuthState build() => AuthState.unauthenticated();
}

void main() {
  group('resolveAuthRedirect', () {
    test('an unauthenticated user is redirected off every protected route', () {
      for (final location in const [
        '/settings',
        '/dashboard',
        '/transactions',
        '/transactions/abc',
        '/budgets/1?category=Food',
        '/pending-sms',
      ]) {
        expect(
          resolveAuthRedirect(
            status: AuthStatus.unauthenticated,
            location: location,
          ),
          '/login',
          reason: '$location must require a session',
        );
      }
    });

    test('an unauthenticated user may stay on public routes', () {
      for (final location in publicRoutes) {
        expect(
          resolveAuthRedirect(
            status: AuthStatus.unauthenticated,
            location: location,
          ),
          isNull,
        );
      }
    });

    test(
      'an unknown session parks a protected deep link on the splash route',
      () {
        for (final status in const [AuthStatus.initial, AuthStatus.loading]) {
          expect(
            resolveAuthRedirect(status: status, location: '/dashboard'),
            '/',
          );
          expect(
            resolveAuthRedirect(status: status, location: '/login'),
            isNull,
          );
        }
      },
    );

    test('an authenticated user is moved off the sign-in screens', () {
      expect(
        resolveAuthRedirect(
          status: AuthStatus.authenticated,
          location: '/login',
        ),
        '/dashboard',
      );
      expect(
        resolveAuthRedirect(
          status: AuthStatus.authenticated,
          location: '/register',
        ),
        '/onboarding',
      );
    });

    test('an authenticated user may stay on any other route', () {
      for (final location in const ['/', '/dashboard', '/settings', '/loans']) {
        expect(
          resolveAuthRedirect(
            status: AuthStatus.authenticated,
            location: location,
          ),
          isNull,
        );
      }
    });

    test('query strings and trailing slashes do not bypass the guard', () {
      expect(
        resolveAuthRedirect(
          status: AuthStatus.unauthenticated,
          location: '/settings/',
        ),
        '/login',
      );
      expect(
        resolveAuthRedirect(
          status: AuthStatus.authenticated,
          location: '/login?redirect=%2Fsettings',
        ),
        '/dashboard',
      );
    });
  });

  testWidgets(
    'an unauthenticated deep link to a protected route lands on the login screen',
    (tester) async {
      final container = ProviderContainer(
        overrides: [authProvider.overrideWith(_StubUnauthenticatedAuth.new)],
      );
      addTearDown(container.dispose);

      final router = container.read(routerProvider);
      router.go('/settings');

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await tester.pump();

      expect(find.byType(LoginScreen), findsOneWidget);
      expect(find.byType(SettingsScreen), findsNothing);
    },
  );
}
