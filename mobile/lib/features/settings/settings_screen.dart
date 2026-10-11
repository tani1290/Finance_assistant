import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/auth/auth_notifier.dart';
import '../../shared/widgets/financial_card.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authProvider).user;

    return Scaffold(
      appBar: AppBar(title: const Text('Profile & Settings')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            // User Card
            FinancialCard(
              padding: const EdgeInsets.all(20),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 28,
                    backgroundColor: AppColors.primary,
                    child: Text(
                      user?.firstName.isNotEmpty == true
                          ? user!.firstName[0].toUpperCase()
                          : 'R',
                      style: const TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w700,
                        color: Colors.white,
                      ),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          user?.fullName ?? 'Rahul Sharma',
                          style: const TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          user?.email ?? 'rahul@example.com',
                          style: const TextStyle(
                            fontSize: 13,
                            color: AppColors.darkTextSecondary,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            // Settings list
            FinancialCard(
              padding: EdgeInsets.zero,
              child: Column(
                children: [
                  _buildSettingTile(
                    icon: Icons.shield_outlined,
                    title: 'Privacy & SMS Permissions',
                    subtitle: 'Manage on-device banking SMS detection',
                    onTap: () => context.push('/privacy'),
                  ),
                  const Divider(height: 1),
                  _buildSettingTile(
                    icon: Icons.sync_rounded,
                    title: 'Sync & Network Configuration',
                    subtitle: 'Inspect connectivity & change host IP',
                    onTap: () => context.push('/sync'),
                  ),
                  const Divider(height: 1),
                  _buildSettingTile(
                    icon: Icons.sms_outlined,
                    title: 'Pending SMS Queue',
                    subtitle: 'Review incoming transaction alerts',
                    onTap: () => context.push('/pending-sms'),
                  ),
                  const Divider(height: 1),
                  _buildSettingTile(
                    icon: Icons.flag_outlined,
                    title: 'Savings Milestones',
                    subtitle: 'Track custom financial goals',
                    onTap: () => context.push('/goals'),
                  ),
                  const Divider(height: 1),
                  _buildSettingTile(
                    icon: Icons.credit_card_outlined,
                    title: 'Loans & EMI Planner',
                    subtitle: 'Simulate early payoffs and savings',
                    onTap: () => context.push('/loans'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 32),

            // Logout Button
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                icon: const Icon(
                  Icons.logout_rounded,
                  color: AppColors.expense,
                  size: 18,
                ),
                label: const Text(
                  'Log Out of FinPro',
                  style: TextStyle(
                    color: AppColors.expense,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                onPressed: () async {
                  await ref.read(authProvider.notifier).logout();
                  if (context.mounted) {
                    context.go('/login');
                  }
                },
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  side: BorderSide(
                    color: AppColors.expense.withValues(alpha: 0.3),
                  ),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 20),

            const Text(
              'FinPro Mobile v1.0.0 • Final Year Engineering Project\nCreated for Indian Personal Finance & Decision Support',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 11,
                color: AppColors.darkTextMuted,
                height: 1.5,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSettingTile({
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return ListTile(
      leading: Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: AppColors.primary.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Icon(icon, color: AppColors.primaryLight, size: 20),
      ),
      title: Text(
        title,
        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
      ),
      subtitle: Text(
        subtitle,
        style: const TextStyle(
          fontSize: 12,
          color: AppColors.darkTextSecondary,
        ),
      ),
      trailing: const Icon(Icons.chevron_right_rounded, size: 20),
      onTap: onTap,
    );
  }
}
