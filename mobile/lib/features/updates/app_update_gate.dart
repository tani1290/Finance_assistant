import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/updates/app_update_controller.dart';
import '../../core/updates/update_models.dart';
import 'update_dialog.dart';

/// Owns the launch/resume update check for the whole app.
///
/// It wraps the navigator child and presents [UpdateDialog] once per eligible
/// release. A forced update is presented on every resume until the user
/// installs it; optional and critical updates are dismissed per release by
/// [AppUpdateController].
class AppUpdateGate extends ConsumerStatefulWidget {
  const AppUpdateGate({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<AppUpdateGate> createState() => _AppUpdateGateState();
}

class _AppUpdateGateState extends ConsumerState<AppUpdateGate>
    with WidgetsBindingObserver {
  bool _dialogOpen = false;
  bool _started = false;

  /// Releases already presented in this process. Prevents a rebuild loop from
  /// stacking dialogs while a forced update remains pending.
  final Set<String> _presented = <String>{};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _runCheck());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _runCheck(force: true);
    }
  }

  Future<void> _runCheck({bool force = false}) async {
    if (!mounted) return;
    if (!_started) {
      _started = true;
      // Resolve the persisted dismissal before the first prompt.
      await Future<void>.delayed(Duration.zero);
    }
    await ref.read(appUpdateProvider.notifier).check(force: force);
    _maybePresent();
  }

  void _maybePresent() {
    if (!mounted || _dialogOpen) return;
    final state = ref.read(appUpdateProvider);
    if (!state.shouldPrompt) return;

    final key = state.latestReleaseKey;
    if (key != null && _presented.contains(key)) {
      final forced = state.result?.status == UpdateStatus.forced;
      if (!forced) return;
    }
    if (key != null) _presented.add(key);

    final result = state.result;
    if (result?.latest == null) return;

    _dialogOpen = true;
    showDialog<void>(
      context: context,
      useRootNavigator: true,
      barrierDismissible: result!.status != UpdateStatus.forced,
      builder: (_) => UpdateDialog(result: result),
    ).whenComplete(() {
      _dialogOpen = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    // Re-evaluate whenever a check completes. Presentation itself is deferred
    // to a post-frame callback because showDialog needs a stable navigator.
    ref.listen<AppUpdateState>(appUpdateProvider, (previous, next) {
      if (next.checking) return;
      WidgetsBinding.instance.addPostFrameCallback((_) => _maybePresent());
    });
    return widget.child;
  }
}
