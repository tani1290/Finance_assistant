import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/config/theme_preference.dart';
import 'router.dart';
import 'theme/app_theme.dart';

class FinProMobileApp extends ConsumerWidget {
  const FinProMobileApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // The router owns the global auth guard: it redirects a revoked or expired
    // session to sign-in, and an authenticated session away from the auth
    // screens, from a single place.
    final router = ref.watch(routerProvider);
    // Appearance follows the user's persisted choice; dark remains the default.
    final themePreference = ref.watch(themePreferenceProvider);

    return MaterialApp.router(
      title: 'FinPro',
      debugShowCheckedModeBanner: false,
      themeMode: themeModeFor(themePreference),
      theme: AppTheme.lightTheme(),
      darkTheme: AppTheme.darkTheme(),
      routerConfig: router,
    );
  }
}
