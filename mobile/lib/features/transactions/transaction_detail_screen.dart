import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/models/transaction_model.dart';
import '../../core/utils/currency_formatter.dart';
import '../../core/utils/date_formatter.dart';
import '../../shared/widgets/empty_state_view.dart';
import '../../shared/widgets/financial_card.dart';
import '../../shared/widgets/skeleton_loader.dart';
import '../../shared/widgets/status_badge.dart';

class TransactionDetailScreen extends StatefulWidget {
  final String transactionId;

  const TransactionDetailScreen({super.key, required this.transactionId});

  @override
  State<TransactionDetailScreen> createState() =>
      _TransactionDetailScreenState();
}

class _TransactionDetailScreenState extends State<TransactionDetailScreen> {
  bool _isLoading = true;
  TransactionModel? _transaction;

  @override
  void initState() {
    super.initState();
    _fetchDetail();
  }

  Future<void> _fetchDetail() async {
    try {
      final res = await apiClient.get(
        '${ApiEndpoints.transactions}/${widget.transactionId}',
      );
      if (res.statusCode == 200 && res.data['success'] == true) {
        setState(() {
          _transaction = TransactionModel.fromJson(res.data['data']);
          _isLoading = false;
        });
      } else {
        setState(() => _isLoading = false);
      }
    } catch (_) {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _handleDelete() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Transaction?'),
        content: const Text(
          'This will atomically reverse the amount from your account balance.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.expense),
            child: const Text('Delete', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      try {
        await apiClient.delete(
          '${ApiEndpoints.transactions}/${widget.transactionId}',
        );
        if (mounted) {
          context.pop();
        }
      } catch (_) {}
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    if (_isLoading) {
      return Scaffold(
        appBar: AppBar(title: const Text('Transaction Details')),
        body: const Padding(
          padding: EdgeInsets.all(20),
          child: Column(
            children: [
              SizedBox(height: 8),
              SkeletonLoader(width: 88, height: 88, borderRadius: 44),
              SizedBox(height: 18),
              SkeletonLoader(width: 180, height: 30),
              SizedBox(height: 12),
              SkeletonLoader(width: 130, height: 18),
              SizedBox(height: 36),
              SkeletonLoader(
                width: double.infinity,
                height: 260,
                borderRadius: 18,
              ),
            ],
          ),
        ),
      );
    }

    final tx = _transaction;
    if (tx == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Transaction Details')),
        body: const EmptyStateView(
          icon: Icons.receipt_long_outlined,
          title: 'Transaction Not Found',
          description:
              'This transaction may have been deleted or is no longer available.',
        ),
      );
    }

    final accent = tx.isIncome ? AppColors.income : AppColors.expense;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Transaction Details'),
        actions: [
          IconButton(
            icon: const Icon(
              Icons.delete_outline_rounded,
              color: AppColors.expense,
            ),
            onPressed: _handleDelete,
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
        child: Column(
          children: [
            Center(
              child: Column(
                children: [
                  Container(
                    width: 72,
                    height: 72,
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [
                          accent.withValues(alpha: 0.22),
                          accent.withValues(alpha: 0.08),
                        ],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      shape: BoxShape.circle,
                      border: Border.all(color: accent.withValues(alpha: 0.25)),
                    ),
                    child: Icon(
                      tx.isIncome
                          ? Icons.arrow_downward_rounded
                          : Icons.arrow_upward_rounded,
                      size: 32,
                      color: accent,
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    '${tx.isIncome ? "+" : "-"}${CurrencyFormatter.format(tx.amount)}',
                    style: TextStyle(
                      fontSize: 34,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.5,
                      color: tx.isIncome ? AppColors.income : accent,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    tx.merchant ?? tx.description ?? 'Merchant',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textPrimary(isDark),
                    ),
                  ),
                  const SizedBox(height: 12),
                  StatusBadge(
                    label: tx.isIncome ? 'Credit / Income' : 'Debit / Expense',
                    color: accent,
                    icon: tx.isIncome
                        ? Icons.arrow_downward_rounded
                        : Icons.arrow_upward_rounded,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 32),
            FinancialCard(
              padding: const EdgeInsets.all(18),
              child: Column(
                children: [
                  _DetailRow(
                    label: 'Category',
                    value: tx.categoryName,
                    isDark: isDark,
                  ),
                  _divider(isDark),
                  _DetailRow(
                    label: 'Date & Time',
                    value: DateFormatter.formatWithTime(tx.date),
                    isDark: isDark,
                  ),
                  _divider(isDark),
                  _DetailRow(
                    label: 'Account',
                    value: tx.accountName ?? 'Primary Account',
                    isDark: isDark,
                  ),
                  _divider(isDark),
                  _DetailRow(
                    label: 'Payment Mode',
                    value: tx.paymentMethod ?? 'UPI / Bank Transfer',
                    isDark: isDark,
                  ),
                  if (tx.description != null && tx.description!.isNotEmpty) ...[
                    _divider(isDark),
                    _DetailRow(
                      label: 'Description',
                      value: tx.description!,
                      isDark: isDark,
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _divider(bool isDark) =>
      Divider(height: 26, color: AppColors.border(isDark).withValues(alpha: 0.6));
}

class _DetailRow extends StatelessWidget {
  final String label;
  final String value;
  final bool isDark;

  const _DetailRow({
    required this.label,
    required this.value,
    required this.isDark,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 13.5,
            color: AppColors.textSecondary(isDark),
          ),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Text(
            value,
            textAlign: TextAlign.right,
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: AppColors.textPrimary(isDark),
            ),
          ),
        ),
      ],
    );
  }
}
