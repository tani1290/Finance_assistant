import 'dart:async';

import '../api/api_client.dart';
import '../api/api_endpoints.dart';

/// Registers and removes this device's push token.
///
/// Registration includes a stable per-install `deviceId`, so the backend can
/// keep one token per device instead of deleting the user's other devices.
/// Removal targets the platform token, which is unique per installation.
///
/// The server-side removal must run while the access token is still valid, so
/// callers invoke [unregister] during sign-out *before* the local session is
/// cleared. Every step is best-effort and time-bounded: an unreachable backend
/// must never delay or block a user's sign-out.
class FcmTokenManager {
  FcmTokenManager({
    required ApiClient client,
    required Future<String?> Function() tokenProvider,
    required Future<void> Function() localTokenDeleter,
    Duration serverTimeout = const Duration(seconds: 5),
    Duration localTimeout = const Duration(seconds: 2),
  }) : _client = client,
       _tokenProvider = tokenProvider,
       _localTokenDeleter = localTokenDeleter,
       _serverTimeout = serverTimeout,
       _localTimeout = localTimeout;

  final ApiClient _client;
  final Future<String?> Function() _tokenProvider;
  final Future<void> Function() _localTokenDeleter;
  final Duration _serverTimeout;
  final Duration _localTimeout;

  bool _inProgress = false;

  /// True while an unregister runs. Concurrent sign-outs are ignored so a
  /// double-tap on Log Out cannot issue two delete sequences.
  bool get isInProgress => _inProgress;

  /// Registers [token] for this installation.
  ///
  /// Returns true when the backend acknowledged the registration. Failures are
  /// swallowed so a push-registration problem never breaks login or app start;
  /// the next token refresh retries.
  Future<bool> register({
    required String token,
    required String deviceId,
    required String platform,
  }) async {
    if (token.isEmpty || deviceId.isEmpty) return false;

    try {
      await _client
          .post(
            ApiEndpoints.fcmToken,
            data: {
              'fcmToken': token,
              'deviceId': deviceId,
              'platform': platform,
            },
          )
          .timeout(_serverTimeout);
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Returns true when the backend acknowledged the removal (or there was no
  /// token to remove). The platform token is deleted afterwards regardless, so
  /// a slow or failed server call still leaves the device unregistered locally.
  Future<bool> unregister() async {
    if (_inProgress) return false;
    _inProgress = true;
    try {
      var serverCleared = false;
      try {
        await _unregisterOnServer().timeout(_serverTimeout);
        serverCleared = true;
      } catch (_) {
        // Timeout or transport failure: fall through to local deletion.
        serverCleared = false;
      }

      try {
        await _localTokenDeleter().timeout(_localTimeout);
      } catch (_) {
        // Best-effort. A later launch re-registers a fresh token.
      }

      return serverCleared;
    } finally {
      _inProgress = false;
    }
  }

  Future<void> _unregisterOnServer() async {
    final token = await _tokenProvider();
    if (token == null || token.isEmpty) {
      // No device token to target. Skip rather than calling DELETE with an
      // empty body, which the backend treats as "delete every token for this
      // user" and would sign the user's other devices out of push.
      return;
    }
    await _client.delete(ApiEndpoints.fcmToken, data: {'fcmToken': token});
  }
}
