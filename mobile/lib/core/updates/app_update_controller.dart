import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/app_info.dart';
import '../utils/app_log.dart';
import 'update_models.dart';
import 'update_preferences.dart';
import 'update_service.dart';

/// Immutable state for the in-app update flow.
class AppUpdateState {
  const AppUpdateState({
    this.checking = false,
    this.result,
    this.dismissedKey,
    this.lastCheckedAt,
  });

  final bool checking;
  final UpdateCheckResult? result;
  final String? dismissedKey;
  final DateTime? lastCheckedAt;

  String? get latestReleaseKey {
    final latest = result?.latest;
    if (latest == null) return null;
    return UpdatePreferences.releaseKey(
      platform: result!.platform,
      version: latest.version,
      build: latest.buildNumber,
    );
  }

  /// Whether a prompt should be presented right now.
  ///
  /// Optional and critical releases respect one dismissal per release; forced
  /// releases always prompt because the installed build is below the minimum
  /// supported version.
  bool get shouldPrompt {
    final current = result;
    if (current == null || !current.hasUpdate) return false;
    if (current.status == UpdateStatus.forced) return true;
    final key = latestReleaseKey;
    return key != null && key != dismissedKey;
  }

  AppUpdateState copyWith({
    bool? checking,
    UpdateCheckResult? result,
    String? dismissedKey,
    DateTime? lastCheckedAt,
  }) {
    return AppUpdateState(
      checking: checking ?? this.checking,
      result: result ?? this.result,
      dismissedKey: dismissedKey ?? this.dismissedKey,
      lastCheckedAt: lastCheckedAt ?? this.lastCheckedAt,
    );
  }
}

/// Drives launch/resume update checks.
///
/// Checks are throttled in memory and on disk so returning to the foreground
/// does not hammer the release API. [check] uses `force: true` only when the
/// user explicitly asks from settings.
class AppUpdateController extends Notifier<AppUpdateState> {
  static const Duration _resumeThrottle = Duration(minutes: 15);

  final UpdateService _service = UpdateService();
  DateTime? _lastAttempt;

  @override
  AppUpdateState build() {
    _restoreDismissal();
    return const AppUpdateState();
  }

  Future<void> _restoreDismissal() async {
    final key = await UpdatePreferences.dismissedRelease();
    final checkedAt = await UpdatePreferences.lastCheckedAt();
    if (key != null || checkedAt != null) {
      state = state.copyWith(dismissedKey: key, lastCheckedAt: checkedAt);
    }
  }

  /// Runs a check unless one is already in flight.
  ///
  /// [force] bypasses the resume throttle. Failures are stored as an error
  /// result and are never thrown to the caller.
  Future<UpdateCheckResult?> check({bool force = false}) async {
    if (!AppInfo.supportsInAppUpdate) return null;
    if (state.checking) return state.result;

    final now = DateTime.now();
    final last = _lastAttempt ?? state.lastCheckedAt;
    if (!force &&
        last != null &&
        now.difference(last) < _resumeThrottle) {
      return state.result;
    }

    _lastAttempt = now;
    state = state.copyWith(checking: true);

    final result = await _service.check();

    if (result.status != UpdateStatus.error) {
      await UpdatePreferences.markChecked();
    }

    state = AppUpdateState(
      checking: false,
      result: result,
      dismissedKey: state.dismissedKey,
      lastCheckedAt: result.status == UpdateStatus.error ? state.lastCheckedAt : now,
    );
    logDebug('[Update] status=${result.status.name} latest=${result.latest?.version}');
    return result;
  }

  /// Records that the user chose to postpone this specific release.
  Future<void> dismissCurrent() async {
    final key = state.latestReleaseKey;
    if (key == null) return;
    await UpdatePreferences.dismiss(key);
    state = state.copyWith(dismissedKey: key);
  }
}

final appUpdateProvider = NotifierProvider<AppUpdateController, AppUpdateState>(
  AppUpdateController.new,
);
