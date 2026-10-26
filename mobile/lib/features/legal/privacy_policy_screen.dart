import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../app/theme/app_colors.dart';
import '../../core/legal/legal_links.dart';
import '../../core/platform/external_link.dart';
import '../../shared/widgets/financial_card.dart';

/// In-app summary of FinPro's privacy policy.
///
/// Every statement here mirrors a verified behaviour in the web policy and in
/// the backend/mobile code. It is intentionally a summary: the hosted policy is
/// the authoritative document, and this screen links to it.
class PrivacyPolicyScreen extends StatelessWidget {
  const PrivacyPolicyScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(title: const Text('Privacy Policy')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            FinancialCard(
              padding: const EdgeInsets.all(20),
              accent: AppColors.primary,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          color: AppColors.primary.withValues(alpha: 0.14),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(
                          Icons.shield_outlined,
                          color: AppColors.primaryLight,
                          size: 22,
                        ),
                      ),
                      const SizedBox(width: 12),
                      const Expanded(
                        child: Text(
                          'How FinPro handles your data',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'FinPro is operated by Jinay Golecha. This summary covers the '
                    'FinPro web app and the Android app (com.finpro.app.finpro_mobile). '
                    'Effective ${LegalLinks.privacyEffectiveDate}.',
                    style: TextStyle(
                      fontSize: 12.5,
                      height: 1.5,
                      color: AppColors.textSecondary(isDark),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),

            const _PolicySection(
              title: 'Information you provide',
              icon: Icons.person_outline_rounded,
              points: [
                'Account details: name, username, email address, and a bcrypt password hash. FinPro never stores your plain-text password.',
                'Financial data you enter or import: accounts, balances, transactions, categories, budgets, goals, bills, subscriptions, loans, insurance, cards, and investments.',
                'Planning data such as income estimates, risk preference, and retirement assumptions.',
                'Receipt images you choose to upload and reports or exports you request.',
                'Messages you send to the FinPro AI assistant and the replies you receive.',
              ],
            ),
            const SizedBox(height: 12),

            const _PolicySection(
              title: 'Information created by using the app',
              icon: Icons.memory_rounded,
              points: [
                'Push-notification tokens, device model, OS version, app version, and last-sync time.',
                'Security and diagnostic records such as IP address, browser user-agent, timestamps, and audit events.',
                'On Android, Firebase Analytics and Firebase Crashlytics may collect app-usage events, crash reports, a Firebase installation identifier, and advertising identifiers permitted by your device settings.',
              ],
            ),
            const SizedBox(height: 12),

            const _PolicySection(
              title: 'Optional SMS detection',
              icon: Icons.sms_outlined,
              points: [
                'Off by default. It is enabled only after this disclosure, your affirmative action, and Android granting the SMS permission.',
                'When enabled, incoming bank or payment messages are read and filtered. OTPs, promotions, payment requests, failed transactions, and balance-only messages are discarded.',
                'Potentially relevant message text is sent to FinPro servers for parsing. The server stores the proposed transaction, sender identifier, a one-way message hash, amount, merchant, and date. The full message body is not stored as a pending transaction.',
                'You review each suggestion before it becomes a transaction. You can disable SMS detection at any time, and FinPro works normally without SMS access.',
              ],
            ),
            const SizedBox(height: 12),

            const _PolicySection(
              title: 'AI features and Google Gemini',
              icon: Icons.auto_awesome_outlined,
              points: [
                'FinPro uses Google\'s Gemini API. Requests may include your first name, email address, your message, recent chat history, a financial snapshot, and tool results needed to answer you.',
                'Google processes that data under its own terms and privacy policy. Do not send information to the AI assistant that you do not want processed by a third-party AI provider.',
                'AI output can be inaccurate or incomplete. It is not financial, investment, tax, or legal advice, and data-changing actions require your explicit confirmation.',
              ],
            ),
            const SizedBox(height: 12),

            const _PolicySection(
              title: 'Sharing',
              icon: Icons.hub_outlined,
              points: [
                'Google Gemini API for AI responses and recommendations.',
                'Google Firebase for push notifications, analytics, and crash reporting.',
                'Cloud hosting, database, and storage providers that run FinPro.',
                'Law enforcement or regulators when a valid legal request requires it.',
                'FinPro does not sell your personal information and does not use your financial records for third-party advertising.',
              ],
            ),
            const SizedBox(height: 12),

            const _PolicySection(
              title: 'Payments are simulated',
              icon: Icons.science_outlined,
              points: [
                'The payment simulator does not connect to banks, UPI, card networks, or real payment processors.',
                'Simulated payments do not move real money and create no real financial obligation.',
                'Never enter real card numbers, UPI PINs, bank passwords, or other payment credentials anywhere in FinPro.',
              ],
            ),
            const SizedBox(height: 12),

            const _PolicySection(
              title: 'Retention and deletion',
              icon: Icons.delete_outline_rounded,
              points: [
                'Account information and linked financial records are kept while your account is active.',
                'Deleting your account permanently removes the account record and the user-owned records linked to it, including uploaded files, push tokens, device records, pending SMS suggestions, and audit records.',
                'Password-based accounts must re-enter their password. Deletion cannot be undone. If cleanup fails partway through, the account is left intact so you can retry.',
                'Residual copies may remain in infrastructure backups or provider logs for a limited period until those systems overwrite them. They are not used to recreate a deleted account.',
              ],
            ),
            const SizedBox(height: 12),

            const _PolicySection(
              title: 'Security',
              icon: Icons.lock_outline_rounded,
              points: [
                'HTTPS protects data in transit, passwords are hashed with bcrypt, and access tokens are short-lived with rotating refresh tokens.',
                'Every financial record and file is scoped to the authenticated account.',
                'No system is completely secure. Keep your password and device safe and sign out on shared devices.',
              ],
            ),
            const SizedBox(height: 12),

            const _PolicySection(
              title: 'Your choices',
              icon: Icons.tune_rounded,
              points: [
                'View and correct your profile and financial records in the app.',
                'Disable push notifications in the app or in Android settings.',
                'Enable or disable SMS detection at any time in Privacy & Permissions.',
                'Delete your account from Profile & Settings → Delete account, or from the public deletion page.',
                'FinPro is not directed to children under 18.',
              ],
            ),
            const SizedBox(height: 20),

            FinancialCard(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Read the full policy',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary(isDark),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'The hosted policy is the authoritative version and includes '
                    'the complete retention, sharing, and contact details.',
                    style: TextStyle(
                      fontSize: 12,
                      height: 1.45,
                      color: AppColors.textSecondary(isDark),
                    ),
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: () => _open(context, LegalLinks.privacyPolicy),
                    icon: const Icon(Icons.open_in_new_rounded, size: 16),
                    label: const Text('Open full privacy policy'),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(44),
                    ),
                  ),
                  const SizedBox(height: 10),
                  OutlinedButton.icon(
                    onPressed: () => _open(context, LegalLinks.supportIssues),
                    icon: const Icon(Icons.support_agent_rounded, size: 16),
                    label: const Text('Contact via public issue tracker'),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(44),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    LegalLinks.supportIssues,
                    style: TextStyle(
                      fontSize: 11,
                      color: AppColors.textMuted(isDark),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  static Future<void> _open(BuildContext context, String url) async {
    final opened = await ExternalLink.open(url);
    if (opened || !context.mounted) return;
    await Clipboard.setData(ClipboardData(text: url));
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Link copied: $url'),
        duration: const Duration(seconds: 6),
      ),
    );
  }
}

class _PolicySection extends StatelessWidget {
  final String title;
  final IconData icon;
  final List<String> points;

  const _PolicySection({
    required this.title,
    required this.icon,
    required this.points,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return FinancialCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 18, color: AppColors.primaryLight),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary(isDark),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          for (final point in points)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Container(
                      width: 4,
                      height: 4,
                      decoration: BoxDecoration(
                        color: AppColors.textMuted(isDark),
                        shape: BoxShape.circle,
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      point,
                      style: TextStyle(
                        fontSize: 12.5,
                        height: 1.5,
                        color: AppColors.textSecondary(isDark),
                      ),
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
