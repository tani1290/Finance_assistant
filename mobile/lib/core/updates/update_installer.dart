import 'dart:async';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter/services.dart';

import '../api/api_endpoints.dart';
import '../utils/app_log.dart';
import 'update_models.dart';

class UpdateException implements Exception {
  const UpdateException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// Downloads an APK, verifies its SHA-256 and hands it to the Android installer.
///
/// iOS has no sideload path: callers must open TestFlight or the App Store
/// instead of constructing this installer. The Android platform channel is
/// the only code that can start an install intent, and it refuses files
/// outside the app cache directory.
class ApkUpdateInstaller {
  ApkUpdateInstaller({Dio? dio})
    : _dio =
          dio ??
          Dio(
            BaseOptions(
              connectTimeout: const Duration(seconds: 20),
              receiveTimeout: const Duration(minutes: 10),
              headers: const {'Accept': 'application/octet-stream'},
            ),
          );

  final Dio _dio;

  static const MethodChannel _channel = MethodChannel(
    'com.finpro.app/platform',
  );

  /// Downloads and verifies [artifact], then requests installation.
  ///
  /// [onProgress] receives 0.0–1.0 when the server reports a content length.
  Future<void> downloadAndInstall(
    ReleaseArtifact artifact, {
    void Function(double progress)? onProgress,
  }) async {
    if (!Platform.isAndroid) {
      throw const UpdateException(
        'In-app installation is only available on Android. Use TestFlight or '
        'the App Store on iOS.',
      );
    }

    final rawUrl = artifact.apkUrl ?? artifact.url;
    if (rawUrl == null) {
      throw const UpdateException(
        'This release does not publish an installable APK yet.',
      );
    }

    final sha256 = artifact.sha256;
    if (sha256 == null) {
      throw const UpdateException(
        'This release has no published checksum, so FinPro will not install '
        'it automatically. Open the download page to install manually.',
      );
    }

    final url = _resolveUrl(rawUrl);
    final file = await _download(url, artifact, onProgress: onProgress);
    try {
      await _verify(file, sha256, artifact.sizeBytes);
      final installed = await _requestInstall(file.path);
      if (!installed) {
        throw const UpdateException(
          'Android did not accept the installation request. Allow "Install '
          'unknown apps" for FinPro and try again.',
        );
      }
    } finally {
      // The FileProvider hands the content URI to the installer, so deleting
      // after the intent is dispatched keeps the cache clean without breaking
      // the install. Keep the file on failure for a retry.
    }
  }

  Future<File> _download(
    String url,
    ReleaseArtifact artifact, {
    void Function(double progress)? onProgress,
  }) async {
    final directory = await Directory.systemTemp.createTemp('finpro_update_');
    final safeName = (artifact.fileName ?? 'finpro-update.apk')
        .replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');
    final target = File('${directory.path}/$safeName');

    try {
      await _dio.download(
        url,
        target.path,
        onReceiveProgress: (received, total) {
          if (onProgress == null || total <= 0) return;
          onProgress((received / total).clamp(0.0, 1.0));
        },
        options: Options(followRedirects: true, maxRedirects: 5),
      );
      return target;
    } on DioException catch (error) {
      try {
        if (await target.exists()) await target.delete();
      } catch (_) {
        // Ignore cleanup failures.
      }
      logDebug('[Update] download failed: $error');
      throw UpdateException(
        'The update download failed. Check your connection and try again.',
      );
    }
  }

  Future<void> _verify(File file, String expected, int? expectedSize) async {
    final length = await file.length();
    if (length <= 0) {
      throw const UpdateException('The downloaded update file is empty.');
    }
    if (expectedSize != null && expectedSize > 0 && length != expectedSize) {
      throw const UpdateException(
        'The downloaded update is incomplete. Please try again.',
      );
    }

    final digest = await sha256.bind(file.openRead()).first;
    final actual = digest.toString().toLowerCase();
    if (actual != expected.toLowerCase()) {
      try {
        await file.delete();
      } catch (_) {
        // Ignore cleanup failures.
      }
      throw const UpdateException(
        'The update failed its integrity check and was discarded. Please '
        'download it again from the official page.',
      );
    }
  }

  Future<bool> _requestInstall(String path) async {
    try {
      final accepted = await _channel.invokeMethod<bool>('installApk', {
        'filePath': path,
      });
      return accepted ?? false;
    } on PlatformException catch (error) {
      if (error.code == 'PERMISSION_REQUIRED') {
        throw const UpdateException(
          'Allow FinPro to install unknown apps in Android settings, then tap '
          'Update again.',
        );
      }
      throw UpdateException(
        error.message?.trim().isNotEmpty == true
            ? error.message!.trim()
            : 'Android could not start the installer.',
      );
    } catch (_) {
      return false;
    }
  }

  /// Opens the system settings page for "Install unknown apps".
  static Future<bool> openInstallPermissionSettings() async {
    try {
      final opened = await _channel.invokeMethod<bool>(
        'openInstallPermissionSettings',
      );
      return opened ?? false;
    } catch (_) {
      return false;
    }
  }

  /// Resolves a same-origin relative artifact URL against the API host.
  String _resolveUrl(String raw) {
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    final base = Uri.tryParse(ApiEndpoints.baseUrl);
    if (base == null) {
      throw const UpdateException('The update URL could not be resolved.');
    }
    return base.resolve(raw).toString();
  }
}
