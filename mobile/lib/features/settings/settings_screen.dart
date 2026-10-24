import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/auth/auth_notifier.dart';
import '../../core/config/theme_preference.dart';
import '../../shared/widgets/financial_card.dart';
import '../../shared/widgets/pressable.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final user = ref.watch(authProvider).user;
    final themePreference = ref.watch(themePreferenceProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Profile & Settings')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
        child: Column(
          children: [
            // ── Identity card ────────────────────────────────────────
            FinancialCard(
              padding: const EdgeInsets.all(20),
              onTap: () => context.push('/profile'),
              child: Row(
                children: [
                  Container(
                    width: 60,
                    height: 60,
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: AppColors.primaryGradient,
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      borderRadius: BorderRadius.circular(18),
                      boxShadow: AppColors.glow(
                        AppColors.primary,
                        strength: 0.5,
                      ),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      user?.firstName.isNotEmpty == true
                          ? user!.firstName[0].toUpperCase()
                          : 'F',
                      style: const TextStyle(
                        fontSize: 24,
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
                          user?.fullName ?? 'Your account',
                          style: TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w700,
                            color: AppColors.textPrimary(isDark),
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          user?.email ?? 'Email unavailable',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 13,
                            color: AppColors.textSecondary(isDark),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Icon(
                    Icons.chevron_right_rounded,
                    size: 20,
                    color: AppColors.textMuted(isDark),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            _SectionLabel('Account', isDark: isDark),
            FinancialCard(
              padding: EdgeInsets.zero,
              child: _SettingTile(
                icon: Icons.person_outline_rounded,
                title: 'View & Edit Profile',
                subtitle: 'Name, city, occupation and financial profile',
                isDark: isDark,
                onTap: () => context.push('/profile'),
              ),
            ),
            const SizedBox(height: 20),

            _SectionLabel('Appearance', isDark: isDark),
            FinancialCard(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Theme',
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 14,
                      color: AppColors.textPrimary(isDark),
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Dark matches the web app. System follows your device.',
                    style: TextStyle(
                      fontSize: 12,
                      color: AppColors.textSecondary(isDark),
                    ),
                  ),
                  const SizedBox(height: 14),
                  SizedBox(
                    width: double.infinity,
                    child: SegmentedButton<AppThemePreference>(
                      segments: [
                        for (final preference in AppThemePreference.values)
                          ButtonSegment(
                            value: preference,
                            label: Text(preference.label),
                          ),
                      ],
                      selected: {themePreference},
                      showSelectedIcon: false,
                      onSelectionChanged: (selection) {
                        HapticFeedback.selectionClick();
                        ref
                            .read(themePreferenceProvider.notifier)
                            .select(selection.first);
                      },
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            _SectionLabel('Preferences', isDark: isDark),
            FinancialCard(
              padding: EdgeInsets.zero,
              child: Column(
                children: [
                  _SettingTile(
                    icon: Icons.shield_outlined,
                    title: 'Privacy & SMS Permissions',
                    subtitle: 'Manage on-device banking SMS detection',
                    isDark: isDark,
                    onTap: () => context.push('/privacy'),
                  ),
                  Divider(height: 1, color: AppColors.border(isDark)),
                  _SettingTile(
                    icon: Icons.sync_rounded,
                    title: 'Sync & Network',
                    subtitle: 'Inspect connectivity & change host IP',
                    isDark: isDark,
                    onTap: () => context.push('/sync'),
                  ),
                  Divider(height: 1, color: AppColors.border(isDark)),
                  _SettingTile(
                    icon: Icons.sms_outlined,
                    title: 'Pending SMS Queue',
                    subtitle: 'Review incoming transaction alerts',
                    isDark: isDark,
                    onTap: () => context.push('/pending-sms'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            _SectionLabel('Planning tools', isDark: isDark),
            FinancialCard(
              padding: EdgeInsets.zero,
              child: Column(
                children: [
                  _SettingTile(
                    icon: Icons.flag_outlined,
                    title: 'Savings Milestones',
                    subtitle: 'Track custom financial goals',
                    isDark: isDark,
                    onTap: () => context.push('/goals'),
                  ),
                  Divider(height: 1, color: AppColors.border(isDark)),
                  _SettingTile(
                    icon: Icons.credit_card_outlined,
                    title: 'Loans & EMI Planner',
                    subtitle: 'Simulate early payoffs and savings',
                    isDark: isDark,
                    onTap: () => context.push('/loans'),
                  ),
                  Divider(height: 1, color: AppColors.border(isDark)),
                  _SettingTile(
                    icon: Icons.trending_up_rounded,
                    title: 'Investments',
                    subtitle: 'Review your portfolio and SIPs',
                    isDark: isDark,
                    onTap: () => context.push('/investments'),
                  ),
                  Divider(height: 1, color: AppColors.border(isDark)),
                  _SettingTile(
                    icon: Icons.event_note_outlined,
                    title: 'Financial Calendar',
                    subtitle: 'EMIs, renewals and custom reminders',
                    isDark: isDark,
                    onTap: () => context.push('/calendar'),
                  ),
                  Divider(height: 1, color: AppColors.border(isDark)),
                  _SettingTile(
                    icon: Icons.shield_outlined,
                    title: 'Insurance & Subscriptions',
                    subtitle: 'Cover, premiums and recurring bills',
                    isDark: isDark,
                    onTap: () => context.push('/insurance'),
                  ),
                  Divider(height: 1, color: AppColors.border(isDark)),
                  _SettingTile(
                    icon: Icons.science_outlined,
                    title: 'Payment Simulator',
                    subtitle: 'Synthetic demo payments — no real money moves',
                    isDark: isDark,
                    onTap: () => context.push('/simulator'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 28),

            // ── Logout ───────────────────────────────────────────────
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
                  HapticFeedback.mediumImpact();
                  await ref.read(authProvider.notifier).logout();
                  if (context.mounted) {
                    context.go('/login');
                  }
                },
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 15),
                  side: BorderSide(
                    color: AppColors.expense.withValues(alpha: 0.3),
                  ),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 24),

            Text(
              'FinPro Mobile v1.0.0\nIndian Personal Finance & Decision Support',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 11,
                color: AppColors.textMuted(isDark),
                height: 1.5,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  final String label;
  final bool isDark;

  const _SectionLabel(this.label, {required this.isDark});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 4, bottom: 10),
      child: Align(
        alignment: Alignment.centerLeft,
        child: Text(
          label.toUpperCase(),
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.9,
            color: AppColors.textMuted(isDark),
          ),
        ),
      ),
    );
  }
}

class _SettingTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final bool isDark;
  final VoidCallback onTap;

  const _SettingTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.isDark,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Pressable(
      onTap: onTap,
      borderRadius: BorderRadius.circular(0),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(9),
              decoration: BoxDecoration(
                color: AppColors.primary.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(icon, color: AppColors.primaryLight, size: 19),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 14,
                      color: AppColors.textPrimary(isDark),
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: TextStyle(
                      fontSize: 12,
                      color: AppColors.textSecondary(isDark),
                    ),
                  ),
                ],
              ),
            ),
            Icon(
              Icons.chevron_right_rounded,
              size: 20,
              color: AppColors.textMuted(isDark),
            ),
          ],
        ),
      ),
    );
  }
}
