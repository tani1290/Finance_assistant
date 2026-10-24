import 'package:flutter/foundation.dart';

/// Raised when the build-time API configuration is missing, malformed, or
/// unsafe for the current build mode.
class ApiConfigurationException implements Exception {
  const ApiConfigurationException(this.message);

  final String message;

  @override
  String toString() => 'ApiConfigurationException: $message';
}

/// Resolves and validates the backend base URL for each build mode.
///
/// Rules:
/// - The URL may be supplied at build time with
///   `--dart-define=API_BASE_URL=https://host/api/v1`.
/// - Release builds default to the known production endpoint and must use
///   HTTPS. A plaintext `http://` override is rejected outright.
/// - Non-release builds default to a local development backend so a debug
///   build never silently talks to production.
/// - Anything that is not an absolute `http(s)` URL with a host and the
///   `/api/v1` path prefix is rejected before the app can make a request.
class AppEnvironment {
  AppEnvironment._();

  /// The known production API base URL.
  static const String productionBaseUrl =
      'https://finpro-finance-ai.onrender.com/api/v1';

  /// Local development backend port used by the bundled node-backend.
  static const int localDevPort = 5001;

  /// Path every backend route is mounted under.
  static const String apiPathSuffix = '/api/v1';

  /// Supplied with `--dart-define=API_BASE_URL=...`.
  static const String _configuredBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: '',
  );

  /// The raw, unvalidated value from the build environment (may be empty).
  static String get configuredBaseUrl => _configuredBaseUrl.trim();

  /// The local backend URL for the host platform.
  ///
  /// Android emulators reach the host machine through `10.0.2.2`; every other
  /// target (iOS simulator, desktop) can use the loopback address directly.
  static String localDefaultBaseUrl({TargetPlatform? platform}) {
    final target = platform ?? defaultTargetPlatform;
    final host = target == TargetPlatform.android ? '10.0.2.2' : '127.0.0.1';
    return 'http://$host:$localDevPort$apiPathSuffix';
  }

  /// Resolves the effective base URL for a build.
  ///
  /// [isRelease] defaults to [kReleaseMode]; [override] lets callers inject a
  /// value (used by tests and by the debug-only runtime host override).
  static String resolve({
    bool? isRelease,
    String? override,
    TargetPlatform? platform,
  }) {
    final release = isRelease ?? kReleaseMode;
    final configured = (override ?? configuredBaseUrl).trim();

    final fallback = release
        ? productionBaseUrl
        : localDefaultBaseUrl(platform: platform);

    final candidate = configured.isEmpty ? fallback : configured;
    return validate(candidate, isRelease: release);
  }

  /// Strictly validates a base URL and returns a normalized form (trailing
  /// slashes removed). Throws [ApiConfigurationException] when invalid.
  static String validate(String rawUrl, {required bool isRelease}) {
    final trimmed = rawUrl.trim();
    if (trimmed.isEmpty) {
      throw const ApiConfigurationException('No API base URL is configured.');
    }

    final uri = Uri.tryParse(trimmed);
    if (uri == null || !uri.hasScheme || uri.host.isEmpty) {
      throw ApiConfigurationException(
        '"$trimmed" is not a valid absolute URL.',
      );
    }

    if (uri.scheme != 'http' && uri.scheme != 'https') {
      throw ApiConfigurationException(
        'The API URL must use http or https (got "${uri.scheme}").',
      );
    }

    if (uri.userInfo.isNotEmpty) {
      throw const ApiConfigurationException(
        'The API URL must not embed credentials.',
      );
    }

    if (uri.query.isNotEmpty || uri.fragment.isNotEmpty) {
      throw const ApiConfigurationException(
        'The API URL must not contain a query string or fragment.',
      );
    }

    if (isRelease && uri.scheme != 'https') {
      throw const ApiConfigurationException(
        'Release builds require an HTTPS API URL.',
      );
    }

    final path = _stripTrailingSlashes(uri.path);
    if (!path.endsWith(apiPathSuffix)) {
      throw const ApiConfigurationException(
        'The API URL must end with "$apiPathSuffix".',
      );
    }

    return uri.replace(path: path).toString();
  }

  /// Lenient normalization for the debug-only runtime host override.
  ///
  /// Unlike [validate] this does not require the `/api/v1` suffix, because the
  /// in-app editor lets a developer point at any mount point. It still rejects
  /// non-absolute URLs and plaintext HTTP in release builds.
  static String normalizeForRuntime(String rawUrl) {
    final trimmed = rawUrl.trim();
    final uri = Uri.tryParse(trimmed);
    if (uri == null ||
        !uri.hasScheme ||
        uri.host.isEmpty ||
        (uri.scheme != 'http' && uri.scheme != 'https')) {
      throw ApiConfigurationException(
        '"$trimmed" is not a valid http(s) API URL.',
      );
    }
    if (kReleaseMode && uri.scheme != 'https') {
      throw const ApiConfigurationException(
        'Release builds require an HTTPS API URL.',
      );
    }
    final path = _stripTrailingSlashes(uri.path);
    return uri.replace(path: path).toString();
  }

  static String _stripTrailingSlashes(String path) {
    var result = path;
    while (result.endsWith('/')) {
      result = result.substring(0, result.length - 1);
    }
    return result;
  }
}
