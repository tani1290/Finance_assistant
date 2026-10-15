import 'package:flutter/material.dart';
import '../../app/theme/app_colors.dart';

/// A consistent section title with an optional trailing action.
///
/// Replaces the ad-hoc `Row(title, TextButton('View All'))` blocks that were
/// duplicated across screens so spacing and type scale stay identical.
class SectionHeader extends StatelessWidget {
  final String title;
  final String? subtitle;
  final String? actionLabel;
  final VoidCallback? onAction;
  final IconData? actionIcon;
  final EdgeInsetsGeometry padding;

  const SectionHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.actionLabel,
    this.onAction,
    this.actionIcon,
    this.padding = const EdgeInsets.only(bottom: 12),
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Padding(
      padding: padding,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                if (subtitle != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    subtitle!,
                    style: TextStyle(
                      fontSize: 12.5,
                      color: isDark
                          ? AppColors.darkTextSecondary
                          : AppColors.lightTextSecondary,
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (actionLabel != null && onAction != null)
            TextButton(
              onPressed: onAction,
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: Row(
                children: [
                  Text(actionLabel!, style: const TextStyle(fontSize: 13)),
                  const SizedBox(width: 2),
                  Icon(
                    actionIcon ?? Icons.chevron_right_rounded,
                    size: 16,
                    color: isDark
                        ? AppColors.primaryLight
                        : AppColors.primary,
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
