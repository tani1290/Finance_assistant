import 'package:flutter/material.dart';
import '../../app/theme/app_colors.dart';

class StatusBadge extends StatelessWidget {
  final String label;
  final Color color;
  final Color? backgroundColor;
  final IconData? icon;

  const StatusBadge({
    super.key,
    required this.label,
    required this.color,
    this.backgroundColor,
    this.icon,
  });

  factory StatusBadge.income({String label = 'Credit'}) {
    return StatusBadge(
      label: label,
      color: AppColors.income,
      backgroundColor: AppColors.incomeBadgeBg,
      icon: Icons.arrow_downward_rounded,
    );
  }

  factory StatusBadge.expense({String label = 'Debit'}) {
    return StatusBadge(
      label: label,
      color: AppColors.expense,
      backgroundColor: AppColors.expenseBadgeBg,
      icon: Icons.arrow_upward_rounded,
    );
  }

  factory StatusBadge.pending({String label = 'Pending Review'}) {
    return StatusBadge(
      label: label,
      color: AppColors.warning,
      backgroundColor: AppColors.pendingBadgeBg,
      icon: Icons.hourglass_top_rounded,
    );
  }

  factory StatusBadge.duplicate({String label = 'Duplicate Warning'}) {
    return StatusBadge(
      label: label,
      color: AppColors.purple,
      backgroundColor: AppColors.purple.withValues(alpha: 0.15),
      icon: Icons.copy_rounded,
    );
  }

  @override
  Widget build(BuildContext context) {
    final bg = backgroundColor ?? color.withValues(alpha: 0.15);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.25), width: 1),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 12, color: color),
            const SizedBox(width: 4),
          ],
          Text(
            label,
            style: TextStyle(
              fontSize: 11.5,
              fontWeight: FontWeight.w600,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}
