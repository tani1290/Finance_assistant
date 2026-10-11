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
  String _serverStatus = 'Online (Connected)';
  DateTime? _lastSyncTime = DateTime.now();
  int _pendingSmsCount = 0;
  final _baseUrlController = TextEditingController(text: ApiEndpoints.baseUrl);

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
      if (res.statusCode == 200 && res.data['success'] == true) {
        setState(() {
          _serverStatus = 'Online (Connected)';
          _lastSyncTime = DateTime.now();
          _pendingSmsCount =
              res.data['data']['summary']['pendingSmsCount'] ?? 0;
        });
      }
    } catch (_) {
      setState(() {
        _serverStatus = 'Offline / Connecting';
      });
    }
  }

  Future<void> _performManualSync() async {
    setState(() => _isSyncing = true);
    try {
      // 1. Sync buffered SMS
      final smsCount = await SmsPlatformChannel.syncBufferedMessagesToBackend();

      // 2. Fetch fresh state
      final res = await apiClient.get(ApiEndpoints.mobileSync);
      if (res.statusCode == 200) {
        setState(() {
          _lastSyncTime = DateTime.now();
          _serverStatus = 'Online (Connected)';
          _pendingSmsCount =
              res.data['data']['summary']['pendingSmsCount'] ?? 0;
        });
      }

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Sync completed ($smsCount new messages ingested)'),
            backgroundColor: AppColors.primary,
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
                      const Text(
                        'Backend API Status',
                        style: TextStyle(fontWeight: FontWeight.w600),
                      ),
                      Row(
                        children: [
                          Container(
                            width: 8,
                            height: 8,
                            decoration: BoxDecoration(
                              color: _serverStatus.contains('Online')
                                  ? AppColors.primaryLight
                                  : AppColors.warning,
                              shape: BoxShape.circle,
                            ),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            _serverStatus,
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              color: _serverStatus.contains('Online')
                                  ? AppColors.primaryLight
                                  : AppColors.warning,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                  const Divider(height: 24),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Last Synchronized',
                        style: TextStyle(
                          fontSize: 13,
                          color: AppColors.darkTextSecondary,
                        ),
                      ),
                      Text(
                        DateFormatter.relative(_lastSyncTime),
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                    ],
                  ),
                  const Divider(height: 24),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Pending SMS for Review',
                        style: TextStyle(
                          fontSize: 13,
                          color: AppColors.darkTextSecondary,
                        ),
                      ),
                      Text(
                        '$_pendingSmsCount items',
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            FinancialCard(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'API Host Configuration',
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'Default for Android Emulator is 10.0.2.2:5001. If testing on a physical phone, enter your computer LAN IP (e.g. http://192.168.1.5:5001/api/v1):',
                    style: TextStyle(
                      fontSize: 12.5,
                      color: AppColors.darkTextSecondary,
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
                      ApiEndpoints.baseUrl = _baseUrlController.text.trim();
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('API base URL updated!')),
                      );
                      _checkSyncState();
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.darkSurfaceSubtle,
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
}
