import '../core/auth/auth_state.dart';

/// Routes reachable without an authenticated session.
const Set<String> publicRoutes = <String>{'/', '/login', '/register'};

/// Routes an authenticated user should land on when they open a public
/// auth screen.
const String authenticatedLandingRoute = '/dashboard';

/// Onboarding is where a freshly registered user is sent.
const String registrationLandingRoute = '/onboarding';

/// Pure redirect decision for the global auth guard.
///
/// Returns the location to redirect to, or `null` to allow the navigation.
/// Kept free of framework types so every branch can be unit-tested.
String? resolveAuthRedirect({
  required AuthStatus status,
  required String location,
}) {
  final path = _normalizePath(location);
  final isPublic = publicRoutes.contains(path);

  switch (status) {
    case AuthStatus.authenticated:
      // An authenticated user has no reason to sit on the sign-in or
      // registration screens. Everything else — including the splash route —
      // is left alone so the app can restore the last screen it wanted.
      if (path == '/login') return authenticatedLandingRoute;
      if (path == '/register') return registrationLandingRoute;
      return null;

    case AuthStatus.initial:
    case AuthStatus.loading:
      // The session is not known yet. Public routes are safe to render;
      // park protected deep links on the splash screen until the restore
      // resolves, then this guard re-evaluates.
      return isPublic ? null : '/';

    case AuthStatus.unauthenticated:
      // Protected routes and deep links must never render without a session.
      return isPublic ? null : '/login';
  }
}

String _normalizePath(String location) {
  var path = location;
  final queryIndex = path.indexOf('?');
  if (queryIndex != -1) path = path.substring(0, queryIndex);
  final fragmentIndex = path.indexOf('#');
  if (fragmentIndex != -1) path = path.substring(0, fragmentIndex);
  if (path.isEmpty) return '/';
  if (path.length > 1 && path.endsWith('/')) {
    path = path.substring(0, path.length - 1);
  }
  return path;
}
