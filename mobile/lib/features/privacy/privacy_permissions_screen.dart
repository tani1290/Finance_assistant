import 'package:flutter/material.dart';
import '../../app/theme/app_colors.dart';
import '../../core/sms/sms_platform_channel.dart';
import '../../shared/widgets/financial_card.dart';
import '../../shared/widgets/gradient_button.dart';

class PrivacyPermissionsScreen extends StatefulWidget {
  const PrivacyPermissionsScreen({super.key});

  @override
  State<PrivacyPermissionsScreen> createState() =>
      _PrivacyPermissionsScreenState();
}

class _PrivacyPermissionsScreenState extends State<PrivacyPermissionsScreen> {
  bool _hasSmsPermission = false;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _checkPermissions();
  }

  Future<void> _checkPermissions() async {
    final granted = await SmsPlatformChannel.checkPermission();
    if (mounted) {
      setState(() {
        _hasSmsPermission = granted;
        _isLoading = false;
      });
    }
  }

  Future<void> _requestPermissions() async {
    final granted = await SmsPlatformChannel.requestPermission();
    if (!mounted) return;
    setState(() => _hasSmsPermission = granted);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          granted ? 'SMS permissions enabled!' : 'Permission denied by user',
        ),
        backgroundColor: granted ? AppColors.primary : AppColors.expense,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(title: const Text('Privacy & Permissions')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            FinancialCard(
              padding: const EdgeInsets.all(22),
              child: Column(
                children: [
                  Container(
                    width: 56,
                    height: 56,
                    decoration: BoxDecoration(
                      color: AppColors.primary.withValues(alpha: 0.12),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.shield_outlined,
                      size: 28,
                      color: AppColors.primaryLight,
                    ),
                  ),
                  const SizedBox(height: 14),
                  const Text(
                    'Your Privacy Is Non-Negotiable',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'FinPro processes your bank messages with strict on-device filters. Here is our architectural privacy guarantee:',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 13,
                      color: AppColors.textSecondary(isDark),
                      height: 1.5,
                    ),
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
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Android SMS Detection',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      Switch(
                        value: _hasSmsPermission,
                        onChanged: _isLoading
                            ? null
                            : (_) => _requestPermissions(),
                        activeThumbColor: AppColors.primaryLight,
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _hasSmsPermission
                        ? 'Active: FinPro will detect incoming banking debit & credit alerts.'
                        : 'Disabled: Manual expense entry will be used.',
                    style: TextStyle(
                      fontSize: 13,
                      color: _hasSmsPermission
                          ? AppColors.primaryLight
                          : AppColors.textSecondary(isDark),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            const Text(
              'Security Architecture Highlights',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 12),
            _buildSecurityPoint(
              isDark,
              Icons.lock_rounded,
              'Zero OTP Access',
              'Authentication codes and OTPs are filtered on-device and discarded instantly. They are never uploaded or saved.',
            ),
            const SizedBox(height: 10),
            _buildSecurityPoint(
              isDark,
              Icons.password_rounded,
              'No Banking Credentials',
              'FinPro never requests NetBanking passwords, UPI PINs, or full card numbers.',
            ),
            const SizedBox(height: 10),
            _buildSecurityPoint(
              isDark,
              Icons.verified_user_rounded,
              'Tenant Isolation & Encryption',
              'All synchronized transactions are bound to your authenticated user token using bank-grade 256-bit SSL/TLS.',
            ),
            const SizedBox(height: 28),

            if (!_hasSmsPermission)
              GradientButton(
                text: 'Enable Bank SMS Detection',
                icon: Icons.sms_rounded,
                onPressed: _requestPermissions,
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildSecurityPoint(
    bool isDark,
    IconData icon,
    String title,
    String desc,
  ) {
    return FinancialCard(
      padding: const EdgeInsets.all(16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(icon, color: AppColors.primaryLight, size: 18),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 13.5,
                    color: AppColors.textPrimary(isDark),
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  desc,
                  style: TextStyle(
                    fontSize: 12,
                    color: AppColors.textSecondary(isDark),
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
