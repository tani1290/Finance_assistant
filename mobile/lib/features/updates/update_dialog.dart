import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme/app_colors.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/updates/app_update_controller.dart';
import '../../core/updates/update_installer.dart';
import '../../core/updates/update_models.dart';
import '../../core/platform/external_link.dart';

/// Modal shown when the release API reports a newer build.
///
/// Forced updates cannot be dismissed while an install/open action exists.
/// Optional and critical updates record a dismissal for that exact release so
/// the same prompt is not shown twice.
class UpdateDialog extends ConsumerStatefulWidget {
  const UpdateDialog({super.key, required this.result});

  final UpdateCheckResult result;

  @override
  ConsumerState<UpdateDialog> createState() => _UpdateDialogState();
}

class _UpdateDialogState extends ConsumerState<UpdateDialog> {
  double? _progress;
  String? _error;
  bool _busy = false;

  ReleaseInfo get _latest => widget.result.latest!;

  ReleaseArtifact? get _artifact => _latest.artifactFor(widget.result.platform);

  bool get _isAndroid => widget.result.platform == 'android';

  bool get _isIos => widget.result.platform == 'ios';

  bool get _hasInlineInstall =>
      _isAndroid && (_artifact?.apkUrl ?? _artifact?.url) != null;

  bool get _blocking =>
      widget.result.status == UpdateStatus.forced &&
      (_hasInlineInstall || _externalTarget != null);

  String? get _externalTarget {
    final artifact = _artifact;
    if (artifact == null) return null;
    if (_isAndroid) return artifact.apkUrl ?? artifact.url;
    if (_isIos) {
      return artifact.testflightUrl ?? artifact.appStoreUrl ?? artifact.url;
    }
    return null;
  }

  String get _title => switch (widget.result.status) {
    UpdateStatus.forced => 'Update required',
    UpdateStatus.critical => 'Important update',
    _ => 'Update available',
  };

  String get _message {
    final latest = _latest;
    final current = 'v${widget.result.currentVersion} (${widget.result.currentBuild})';
    final next = 'v${latest.version} (${latest.buildNumber})';
    return switch (widget.result.status) {
      UpdateStatus.forced =>
        'FinPro $next is required. This build ($current) is older than the '
            'minimum supported version. Update to continue securely.',
      UpdateStatus.critical =>
        'FinPro $next includes important fixes. We strongly recommend '
            'updating from $current.',
      _ => 'FinPro $next is ready. You are on $current.',
    };
  }

  Future<void> _dismiss() async {
    await ref.read(appUpdateProvider.notifier).dismissCurrent();
    if (mounted) Navigator.of(context).pop();
  }

  Future<void> _openUrl(String url) async {
    final opened = await ExternalLink.open(url);
    if (!opened && mounted) {
      setState(() {
        _error = 'No browser was available to open the download page.';
      });
    }
  }

  Future<void> _openDownloadCentre() async {
    final base = Uri.tryParse(ApiEndpoints.baseUrl);
    if (base == null) return;
    final page = base.replace(path: '/download.html', query: null, fragment: null);
    await _openUrl(page.toString());
  }

  Future<void> _startUpdate() async {
    if (_busy) return;
    final artifact = _artifact;

    if (_isIos) {
      if (_externalTarget == null) {
        await _openDownloadCentre();
        return;
      }
      await _openUrl(_externalTarget!);
      return;
    }

    if (!_isAndroid || artifact == null) {
      await _openDownloadCentre();
      return;
    }

    // Without a checksum the app refuses to install silently; the official
    // download page remains the safe manual path.
    if (artifact.sha256 == null) {
      await _openDownloadCentre();
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
      _progress = 0;
    });

    try {
      await ApkUpdateInstaller().downloadAndInstall(
        artifact,
        onProgress: (value) {
          if (mounted) setState(() => _progress = value);
        },
      );
      if (mounted) Navigator.of(context).pop();
    } on UpdateException catch (error) {
      if (mounted) {
        setState(() {
          _error = error.message;
          _busy = false;
          _progress = null;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = 'The update could not be installed. Please try again.';
          _busy = false;
          _progress = null;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final latest = _latest;
    final date = latest.displayDate;
    final notes = latest.releaseNotes.take(6).toList();

    return PopScope(
      canPop: !_blocking,
      child: AlertDialog(
        backgroundColor: AppColors.surface(isDark),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
        titlePadding: const EdgeInsets.fromLTRB(24, 24, 24, 0),
        contentPadding: const EdgeInsets.fromLTRB(24, 12, 24, 8),
        actionsPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(9),
              decoration: BoxDecoration(
                color: AppColors.primary.withValues(alpha: 0.14),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(
                widget.result.status == UpdateStatus.forced
                    ? Icons.system_update_alt_rounded
                    : Icons.rocket_launch_rounded,
                color: AppColors.primaryLight,
                size: 20,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                _title,
                style: TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary(isDark),
                ),
              ),
            ),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _message,
                style: TextStyle(
                  fontSize: 13.5,
                  height: 1.45,
                  color: AppColors.textSecondary(isDark),
                ),
              ),
              if (date != null || latest.minimumOs[widget.result.platform] != null) ...[
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  children: [
                    if (date != null)
                      _Chip(label: 'Released $date', isDark: isDark),
                    if (latest.minimumOs[widget.result.platform] != null)
                      _Chip(
                        label:
                            'Requires ${widget.result.platform == 'android' ? 'Android' : 'iOS'} ${latest.minimumOs[widget.result.platform]}',
                        isDark: isDark,
                      ),
                  ],
                ),
              ],
              if (notes.isNotEmpty) ...[
                const SizedBox(height: 14),
                Text(
                  "What's new",
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.4,
                    color: AppColors.textPrimary(isDark),
                  ),
                ),
                const SizedBox(height: 8),
                for (final note in notes)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Container(
                            width: 4,
                            height: 4,
                            decoration: const BoxDecoration(
                              color: AppColors.primaryLight,
                              shape: BoxShape.circle,
                            ),
                          ),
                        ),
                        const SizedBox(width: 9),
                        Expanded(
                          child: Text(
                            note,
                            style: TextStyle(
                              fontSize: 12.5,
                              height: 1.4,
                              color: AppColors.textSecondary(isDark),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
              if (latest.installNotes != null) ...[
                const SizedBox(height: 10),
                Text(
                  latest.installNotes!,
                  style: TextStyle(
                    fontSize: 12,
                    height: 1.4,
                    color: AppColors.textMuted(isDark),
                  ),
                ),
              ],
              if (_busy && _progress != null) ...[
                const SizedBox(height: 16),
                ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value: _progress,
                    minHeight: 6,
                    backgroundColor: AppColors.surfaceSubtle(isDark),
                    color: AppColors.primaryLight,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'Downloading… ${((_progress ?? 0) * 100).round()}%',
                  style: TextStyle(
                    fontSize: 11.5,
                    color: AppColors.textMuted(isDark),
                  ),
                ),
              ],
              if (_error != null) ...[
                const SizedBox(height: 12),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppColors.expense.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    _error!,
                    style: const TextStyle(
                      fontSize: 12,
                      height: 1.4,
                      color: AppColors.expense,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: _busy ? null : _openDownloadCentre,
            child: const Text('All releases'),
          ),
          if (!_blocking)
            TextButton(
              onPressed: _busy ? null : _dismiss,
              child: Text(
                widget.result.status == UpdateStatus.forced ? 'Not now' : 'Later',
              ),
            ),
          FilledButton(
            onPressed: _busy ? null : _startUpdate,
            style: FilledButton.styleFrom(
              backgroundColor: AppColors.primary,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
            ),
            child: Text(
              _busy
                  ? 'Installing…'
                  : _isAndroid
                  ? 'Update now'
                  : 'Open store',
            ),
          ),
        ],
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.isDark});

  final String label;
  final bool isDark;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.surfaceSubtle(isDark),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        label,
        style: TextStyle(fontSize: 10.5, color: AppColors.textSecondary(isDark)),
      ),
    );
  }
}
