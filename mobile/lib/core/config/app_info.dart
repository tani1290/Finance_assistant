import 'package:flutter/foundation.dart';

/// Build-time application identity.
///
/// The release workflow injects the version, build number and channel with
/// `--dart-define` flags so the value inside the binary always matches the
/// artifact that was signed and published. The defaults keep debug builds
/// usable without any flags and match `pubspec.yaml`.
///
/// `package_info_plus` is intentionally not a dependency: reading the platform
/// bundle would require another plugin, and the CI value is authoritative for
/// the update decision.
class AppInfo {
  AppInfo._();

  static const String version = String.fromEnvironment(
    'APP_VERSION',
    defaultValue: '1.0.1',
  );

  /// Milliseconds-safe integer used for ordering releases.
  static const String buildName = String.fromEnvironment(
    'APP_BUILD',
    defaultValue: '2',
  );

  static const String channel = String.fromEnvironment(
    'APP_CHANNEL',
    defaultValue: 'production',
  );

  static int get build {
    final parsed = int.tryParse(buildName.trim());
    return parsed != null && parsed >= 0 ? parsed : 0;
  }

  /// `android`, `ios`, or `null` on an unsupported target.
  static String? get platform {
    if (kIsWeb) return 'web';
    if (defaultTargetPlatform == TargetPlatform.android) return 'android';
    if (defaultTargetPlatform == TargetPlatform.iOS) return 'ios';
    return null;
  }

  /// Whether the update checker can be used for this build.
  ///
  /// Only Android and iOS have release artifacts; desktop/web fall back to a
  /// plain "you are up to date" state instead of querying the API.
  static bool get supportsInAppUpdate {
    final value = platform;
    return value == 'android' || value == 'ios';
  }

  /// Human-readable identity shown in settings and diagnostics.
  static String get displayVersion => 'v$version ($buildName)';
}
