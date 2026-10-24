import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/sms/sms_platform_channel.dart';
import '../../core/utils/date_formatter.dart';
import '../../shared/widgets/financial_card.dart';
import '../../shared/widgets/gradient_button.dart';

class SyncStatusScreen extends StatefulWidget {
  const SyncStatusScreen({super.key});

  @override
  State<SyncStatusScreen> createState() => _SyncStatusScreenState();
}

class _SyncStatusScreenState extends State<SyncStatusScreen> {
  bool _isSyncing = false;
  String _serverStatus = 'Checking…';
  DateTime? _lastSyncTime;
  int _pendingSmsCount = 0;
  final _baseUrlController = TextEditingController(text: ApiEndpoints.baseUrl);

  bool get _isOnline => _serverStatus == 'Online (Connected)';

  @override
  void initState() {
    super.initState();
    _checkSyncState();
  }

  @override
  void dispose() {
    _baseUrlController.dispose();
    super.dispose();
  }

  Future<void> _checkSyncState() async {
    try {
      final res = await apiClient.get(ApiEndpoints.mobileSync);
      if (!mounted) return;
      if (res.statusCode == 200 && res.data['success'] == true) {
        setState(() {
          _serverStatus = 'Online (Connected)';
          _pendingSmsCount = _parsePendingCount(res.data);
        });
      } else {
        setState(() => _serverStatus = 'Offline / Unreachable');
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _serverStatus = 'Offline / Unreachable';
      });
    }
  }

  int _parsePendingCount(dynamic responseData) {
    if (responseData is! Map) return 0;
    final data = responseData['data'];
    if (data is! Map) return 0;
    final summary = data['summary'];
    if (summary is! Map) return 0;
    final pending = summary['pendingSmsCount'];
    if (pending is int) return pending;
    return int.tryParse(pending?.toString() ?? '') ?? 0;
  }

  Future<void> _performManualSync() async {
    setState(() => _isSyncing = true);
    try {
      // 1. Sync buffered SMS
      final smsCount = await SmsPlatformChannel.syncBufferedMessagesToBackend();

      // 2. Fetch fresh state
      final res = await apiClient.get(ApiEndpoints.mobileSync);
      if (!mounted) return;
      final syncOk = res.statusCode == 200 && res.data['success'] == true;
      if (syncOk) {
        setState(() {
          _lastSyncTime = DateTime.now();
          _serverStatus = 'Online (Connected)';
          _pendingSmsCount = _parsePendingCount(res.data);
        });
      } else {
        setState(() => _serverStatus = 'Offline / Unreachable');
      }

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              syncOk
                  ? 'Sync completed ($smsCount new messages ingested)'
                  : 'Sync ran, but the server state could not be confirmed.',
            ),
            backgroundColor: syncOk ? AppColors.primary : AppColors.warning,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Synchronization failed. Check connection.'),
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isSyncing = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(title: const Text('Synchronization Status')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            FinancialCard(
              padding: const EdgeInsets.all(20),
              child: Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Backend API Status',
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                          color: AppColors.textPrimary(isDark),
                        ),
                      ),
                      _StatusPill(
                        label: _serverStatus,
                        color: _isOnline
                            ? AppColors.primaryLight
                            : AppColors.warning,
                      ),
                    ],
                  ),
                  _divider(isDark),
                  _InfoRow(
                    label: 'Last Successful Sync',
                    value: _lastSyncTime == null
                        ? 'Not synced yet'
                        : DateFormatter.relative(_lastSyncTime),
                    isDark: isDark,
                  ),
                  _divider(isDark),
                  _InfoRow(
                    label: 'Pending SMS for Review',
                    value: '$_pendingSmsCount items',
                    isDark: isDark,
                    valueColor: _pendingSmsCount > 0 ? AppColors.warning : null,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            // Runtime host overrides are a development-only tool. Release
            // builds must not let a user (or injected UI) redirect authenticated
            // traffic to an arbitrary host.
            if (kDebugMode)
              FinancialCard(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'API Host Configuration',
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary(isDark),
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Default for Android Emulator is 10.0.2.2:5001. If testing on a physical phone, enter your computer LAN IP (e.g. http://192.168.1.5:5001/api/v1):',
                      style: TextStyle(
                        fontSize: 12.5,
                        color: AppColors.textSecondary(isDark),
                        height: 1.4,
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _baseUrlController,
                      decoration: const InputDecoration(
                        hintText: 'http://10.0.2.2:5001/api/v1',
                        prefixIcon: Icon(Icons.link_rounded, size: 20),
                      ),
                    ),
                    const SizedBox(height: 12),
                    ElevatedButton(
                      onPressed: () {
                        final value = _baseUrlController.text.trim();
                        final uri = Uri.tryParse(value);
                        final isValid =
                            uri != null &&
                            (uri.scheme == 'http' || uri.scheme == 'https') &&
                            uri.host.isNotEmpty;
                        if (!isValid) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text(
                                'Enter a valid http:// or https:// API URL.',
                              ),
                            ),
                          );
                          return;
                        }
                        ApiEndpoints.baseUrl = value;
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('API base URL updated!'),
                          ),
                        );
                        _checkSyncState();
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.surfaceSubtle(isDark),
                        foregroundColor: AppColors.textPrimary(isDark),
                      ),
                      child: const Text('Update Host URL'),
                    ),
                  ],
                ),
              ),
            const SizedBox(height: 28),
            GradientButton(
              text: 'Sync All Records Now',
              icon: Icons.sync_rounded,
              isLoading: _isSyncing,
              onPressed: _performManualSync,
            ),
          ],
        ),
      ),
    );
  }

  Widget _divider(bool isDark) => Divider(
    height: 24,
    color: AppColors.border(isDark).withValues(alpha: 0.6),
  );
}

/// A compact pill showing a coloured status dot alongside a label.
class _StatusPill extends StatelessWidget {
  final String label;
  final Color color;

  const _StatusPill({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 7,
            height: 7,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;
  final bool isDark;
  final Color? valueColor;

  const _InfoRow({
    required this.label,
    required this.value,
    required this.isDark,
    this.valueColor,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 13,
            color: AppColors.textSecondary(isDark),
          ),
        ),
        Text(
          value,
          style: TextStyle(
            fontWeight: FontWeight.w600,
            color: valueColor ?? AppColors.textPrimary(isDark),
          ),
        ),
      ],
    );
  }
}
