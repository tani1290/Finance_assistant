import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/legal/legal_links.dart';
import '../../shared/widgets/financial_card.dart';
import '../../shared/widgets/gradient_button.dart';

/// Public confirmation screen shown after a successful account deletion.
///
/// It is reachable without a session because the app navigates here before it
/// clears local credentials; that ordering keeps the router guard from
/// redirecting a just-deleted user to the sign-in screen mid-flow.
class AccountDeletedScreen extends StatelessWidget {
  const AccountDeletedScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Center(
                    child: Container(
                      width: 72,
                      height: 72,
                      decoration: BoxDecoration(
                        color: AppColors.primary.withValues(alpha: 0.14),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.check_circle_outline_rounded,
                        size: 36,
                        color: AppColors.primaryLight,
                      ),
                    ),
                  ),
                  const SizedBox(height: 20),
                  const Text(
                    'Your account has been deleted',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    'Your FinPro account and the records linked to it have been '
                    'permanently removed. You have been signed out on this device.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 13.5,
                      height: 1.5,
                      color: AppColors.textSecondary(isDark),
                    ),
                  ),
                  const SizedBox(height: 24),
                  FinancialCard(
                    padding: const EdgeInsets.all(18),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'What happens next',
                          style: TextStyle(
                            fontSize: 13.5,
                            fontWeight: FontWeight.w700,
                            color: AppColors.textPrimary(isDark),
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Any residual copies in infrastructure backups or '
                          'provider logs are overwritten on their normal cycle. '
                          'They are not used to recreate a deleted account.',
                          style: TextStyle(
                            fontSize: 12.5,
                            height: 1.5,
                            color: AppColors.textSecondary(isDark),
                          ),
                        ),
                        const SizedBox(height: 10),
                        Text(
                          'If you believe this deletion was a mistake, you can '
                          'create a new account, but the previous data cannot be '
                          'restored.',
                          style: TextStyle(
                            fontSize: 12.5,
                            height: 1.5,
                            color: AppColors.textSecondary(isDark),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 24),
                  GradientButton(
                    text: 'Back to sign in',
                    icon: Icons.login_rounded,
                    onPressed: () => context.go('/login'),
                  ),
                  const SizedBox(height: 8),
                  TextButton(
                    onPressed: () => context.push('/privacy-policy'),
                    child: const Text('Read the privacy policy'),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    LegalLinks.webBaseUrl,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 11,
                      color: AppColors.textMuted(isDark),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
