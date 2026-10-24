import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// User-selectable appearance mode.
///
/// Dark is the product default, matching the web app (which stores
/// `jf_dark_mode` and treats dark as the default experience). Light and
/// system are additive options.
enum AppThemePreference {
  dark,
  light,
  system;

  String get label => switch (this) {
    AppThemePreference.dark => 'Dark',
    AppThemePreference.light => 'Light',
    AppThemePreference.system => 'System',
  };

  IconData get icon => switch (this) {
    AppThemePreference.dark => Icons.dark_mode_outlined,
    AppThemePreference.light => Icons.light_mode_outlined,
    AppThemePreference.system => Icons.brightness_auto_outlined,
  };
}

const _themePreferenceKey = 'finpro_theme_preference';

/// Persists the appearance choice in `SharedPreferences`. The stored value is
/// read back on startup; an unknown/missing value falls back to dark so the
/// first launch and a corrupt entry both behave like the previous build.
class ThemePreferenceNotifier extends Notifier<AppThemePreference> {
  @override
  AppThemePreference build() {
    _restore();
    return AppThemePreference.dark;
  }

  Future<void> _restore() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final stored = prefs.getString(_themePreferenceKey);
      if (stored == null) return;
      final parsed = AppThemePreference.values.firstWhere(
        (preference) => preference.name == stored,
        orElse: () => AppThemePreference.dark,
      );
      if (parsed != state) state = parsed;
    } catch (_) {
      // Preferences are best-effort: a storage failure keeps the default.
    }
  }

  Future<void> select(AppThemePreference preference) async {
    if (preference == state) return;
    state = preference;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_themePreferenceKey, preference.name);
    } catch (_) {
      // Keep the in-memory choice even if it could not be persisted.
    }
  }
}

final themePreferenceProvider =
    NotifierProvider<ThemePreferenceNotifier, AppThemePreference>(
      ThemePreferenceNotifier.new,
    );

ThemeMode themeModeFor(AppThemePreference preference) => switch (preference) {
  AppThemePreference.dark => ThemeMode.dark,
  AppThemePreference.light => ThemeMode.light,
  AppThemePreference.system => ThemeMode.system,
};
