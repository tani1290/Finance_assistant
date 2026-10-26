import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/legal/legal_links.dart';
import '../../core/platform/external_link.dart';

/// Small legal link row shown on pre-auth screens, onboarding and settings.
///
/// The privacy policy is an in-app route so it works offline and needs no
/// browser. Terms and the account-deletion instructions live on the public web
/// deployment; if the platform cannot open a browser, the URL is copied to the
/// clipboard and shown so the user is never left with a dead link.
class LegalFooter extends StatelessWidget {
  final bool showDeletionLink;
  final EdgeInsetsGeometry padding;

  const LegalFooter({
    super.key,
    this.showDeletionLink = true,
    this.padding = const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Padding(
      padding: padding,
      child: Wrap(
        alignment: WrapAlignment.center,
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: 4,
        runSpacing: 0,
        children: [
          _LegalLink(
            label: 'Privacy Policy',
            isDark: isDark,
            onTap: () => context.push('/privacy-policy'),
          ),
          _dot(isDark),
          _LegalLink(
            label: 'Terms',
            isDark: isDark,
            onTap: () => _openExternal(
              context,
              LegalLinks.termsOfService,
              'Terms of Service',
            ),
          ),
          if (showDeletionLink) ...[
            _dot(isDark),
            _LegalLink(
              label: 'Delete account',
              isDark: isDark,
              onTap: () => _openExternal(
                context,
                LegalLinks.accountDeletion,
                'Account deletion',
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _dot(bool isDark) {
    return Text(
      '·',
      style: TextStyle(fontSize: 13, color: AppColors.textMuted(isDark)),
    );
  }

  static Future<void> _openExternal(
    BuildContext context,
    String url,
    String label,
  ) async {
    final opened = await ExternalLink.open(url);
    if (opened || !context.mounted) return;

    await Clipboard.setData(ClipboardData(text: url));
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('$label link copied: $url'),
        duration: const Duration(seconds: 6),
      ),
    );
  }
}

class _LegalLink extends StatelessWidget {
  final String label;
  final bool isDark;
  final VoidCallback onTap;

  const _LegalLink({
    required this.label,
    required this.isDark,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(6),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: AppColors.textSecondary(isDark),
            decoration: TextDecoration.underline,
            decorationColor: AppColors.textMuted(isDark),
          ),
        ),
      ),
    );
  }
}
