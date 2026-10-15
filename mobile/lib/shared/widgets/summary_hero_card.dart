import 'package:flutter/material.dart';
import '../../app/theme/app_colors.dart';

/// The large "headline number" card used at the top of overview screens.
///
/// Renders a gradient hero surface (dark or light aware), a small icon chip,
/// the headline value and optional supporting text / badge. Sharing one
/// implementation keeps the Accounts, Investments and Dashboard headers
/// visually identical.
class SummaryHeroCard extends StatelessWidget {
  final String label;
  final String value;
  final String? subtitle;
  final Widget? badge;
  final IconData? icon;
  final List<Color>? gradient;

  const SummaryHeroCard({
    super.key,
    required this.label,
    required this.value,
    this.subtitle,
    this.badge,
    this.icon,
    this.gradient,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final colors =
        gradient ?? (isDark ? AppColors.heroGradientDark : AppColors.heroGradientLight);
    final onColor = isDark ? Colors.white : AppColors.lightTextPrimary;
    final onColorSoft = isDark
        ? Colors.white.withValues(alpha: 0.72)
        : AppColors.lightTextSecondary;

    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: colors,
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: isDark
              ? Colors.white.withValues(alpha: 0.06)
              : AppColors.lightBorder,
        ),
        boxShadow: AppColors.shadow(isDark),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (icon != null) ...[
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: isDark ? 0.10 : 0.55),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(
                    icon,
                    size: 18,
                    color: isDark ? Colors.white : AppColors.primary,
                  ),
                ),
                const SizedBox(width: 10),
              ],
              Expanded(
                child: Text(
                  label.toUpperCase(),
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.9,
                    color: onColorSoft,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              value,
              style: TextStyle(
                fontSize: 32,
                fontWeight: FontWeight.w800,
                color: onColor,
                letterSpacing: -0.5,
              ),
            ),
          ),
          if (subtitle != null) ...[
            const SizedBox(height: 8),
            Text(
              subtitle!,
              style: TextStyle(fontSize: 12.5, color: onColorSoft),
            ),
          ],
          if (badge != null) ...[
            const SizedBox(height: 14),
            badge!,
          ],
        ],
      ),
    );
  }
}
