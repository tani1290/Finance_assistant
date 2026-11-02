import 'dart:async';

import 'package:dio/dio.dart';

import '../api/api_endpoints.dart';
import '../config/app_info.dart';
import '../utils/app_log.dart';
import 'update_models.dart';

/// Read-only client for the public release metadata API.
///
/// This endpoint never carries user data, so it is called with a bare [Dio]
/// instance. It must remain usable before sign-in (the update check runs from
/// the splash screen) and it must not trigger the authenticated 401 refresh
/// path, which would sign a user out because of a metadata request.
class UpdateService {
  UpdateService({Dio? dio})
    : _dio =
          dio ??
          Dio(
            BaseOptions(
              connectTimeout: const Duration(seconds: 10),
              receiveTimeout: const Duration(seconds: 10),
              headers: const {'Accept': 'application/json'},
            ),
          );

  final Dio _dio;

  static const int _maxAttempts = 3;

  /// Queries the update endpoint for the current build.
  ///
  /// Network failures are surfaced as [UpdateStatus.error] and never thrown:
  /// an unreachable update server must not stop the user from using the app.
  Future<UpdateCheckResult> check() async {
    final platform = AppInfo.platform;
    if (platform == null || !AppInfo.supportsInAppUpdate) {
      return UpdateCheckResult(
        status: UpdateStatus.unavailable,
        platform: platform ?? 'unknown',
        currentVersion: AppInfo.version,
        currentBuild: AppInfo.build,
      );
    }

    Object? lastError;
    for (var attempt = 1; attempt <= _maxAttempts; attempt++) {
      try {
        final response = await _dio.get<dynamic>(
          ApiEndpoints.releaseCheck,
          queryParameters: {
            'platform': platform,
            'version': AppInfo.version,
            'build': AppInfo.build,
            'channel': AppInfo.channel,
          },
        );

        final body = response.data;
        if (body is! Map || body['success'] != true) {
          throw const FormatException('Unexpected update response envelope.');
        }
        final data = body['data'];
        if (data is! Map) {
          throw const FormatException('Missing update payload.');
        }

        return UpdateCheckResult.fromJson(
          Map<String, dynamic>.from(data),
          platform: platform,
          currentVersion: AppInfo.version,
          currentBuild: AppInfo.build,
        );
      } catch (error) {
        lastError = error;
        logDebug('[Update] check attempt $attempt failed: $error');
        if (attempt < _maxAttempts) {
          // Short, bounded backoff. A release check is not time-critical, and
          // the app continues to work while it retries in the background.
          await Future<void>.delayed(Duration(milliseconds: 400 * attempt));
        }
      }
    }

    return UpdateCheckResult.failure(
      platform: platform,
      currentVersion: AppInfo.version,
      currentBuild: AppInfo.build,
      message: 'Could not reach the update server. You can keep using FinPro '
          'and try again later.',
    ).copyWithError(_describe(lastError));
  }

  String? _describe(Object? error) {
    if (error is DioException) {
      final status = error.response?.statusCode;
      if (status != null) return 'Update server returned HTTP $status.';
    }
    return null;
  }
}

extension on UpdateCheckResult {
  /// Preserves the friendly message while adding a technical detail in debug.
  UpdateCheckResult copyWithError(String? detail) {
    if (detail == null) return this;
    return UpdateCheckResult(
      status: status,
      platform: platform,
      currentVersion: currentVersion,
      currentBuild: currentBuild,
      latest: latest,
      previous: previous,
      errorMessage: errorMessage == null
          ? detail
          : '$errorMessage ($detail)',
    );
  }
}
