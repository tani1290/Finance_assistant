import 'package:flutter/material.dart';
import '../../app/theme/app_colors.dart';
import '../../core/models/transaction_model.dart';
import '../../core/utils/currency_formatter.dart';
import '../../core/utils/date_formatter.dart';
import 'financial_card.dart';

/// A single transaction row, shared by the dashboard and the Activity tab.
///
/// Keeping one implementation guarantees the two surfaces never drift apart —
/// amounts, icons, spacing and colours stay identical everywhere.
class TransactionTile extends StatelessWidget {
  final TransactionModel tx;
  final VoidCallback? onTap;

  /// Optional override for the secondary line (e.g. a relative or absolute
  /// date). Defaults to a relative timestamp.
  final String? subtitle;

  const TransactionTile({
    super.key,
    required this.tx,
    this.onTap,
    this.subtitle,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final title = tx.merchant ?? tx.description ?? 'Transaction';

    return FinancialCard(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      onTap: onTap,
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(9),
            decoration: BoxDecoration(
              color: tx.isIncome
                  ? AppColors.incomeBadgeBg
                  : AppColors.expenseBadgeBg,
              shape: BoxShape.circle,
            ),
            child: Icon(
              tx.isIncome
                  ? Icons.arrow_downward_rounded
                  : Icons.arrow_upward_rounded,
              size: 16,
              color: tx.isIncome ? AppColors.income : AppColors.expense,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 13.5,
                    color: AppColors.textPrimary(isDark),
                  ),
                ),
                Text(
                  subtitle ??
                      '${tx.categoryName} • ${DateFormatter.relative(tx.date)}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 11.5,
                    color: AppColors.textSecondary(isDark),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(
            '${tx.isIncome ? "+" : "-"}${CurrencyFormatter.format(tx.amount)}',
            style: TextStyle(
              fontSize: 14.5,
              fontWeight: FontWeight.w700,
              color: tx.isIncome ? AppColors.income : AppColors.textPrimary(isDark),
            ),
          ),
        ],
      ),
    );
  }
}
