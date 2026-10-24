import 'package:finpro_mobile/core/config/theme_preference.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('defaults to dark and maps every preference to a ThemeMode', () {
    SharedPreferences.setMockInitialValues({});
    final container = ProviderContainer();
    addTearDown(container.dispose);

    expect(container.read(themePreferenceProvider), AppThemePreference.dark);
    expect(themeModeFor(AppThemePreference.dark), ThemeMode.dark);
    expect(themeModeFor(AppThemePreference.light), ThemeMode.light);
    expect(themeModeFor(AppThemePreference.system), ThemeMode.system);
  });

  test('restores a persisted non-default preference', () async {
    SharedPreferences.setMockInitialValues({
      'finpro_theme_preference': 'light',
    });
    final container = ProviderContainer();
    addTearDown(container.dispose);

    // build() schedules the async restore; the first read is the default.
    expect(container.read(themePreferenceProvider), AppThemePreference.dark);
    await Future<void>.delayed(const Duration(milliseconds: 10));
    expect(container.read(themePreferenceProvider), AppThemePreference.light);
  });

  test('select persists the choice', () async {
    SharedPreferences.setMockInitialValues({});
    final container = ProviderContainer();
    addTearDown(container.dispose);

    await container
        .read(themePreferenceProvider.notifier)
        .select(AppThemePreference.light);

    expect(container.read(themePreferenceProvider), AppThemePreference.light);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('finpro_theme_preference'), 'light');
  });
}
