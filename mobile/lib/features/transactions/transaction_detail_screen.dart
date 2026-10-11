import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/models/transaction_model.dart';
import '../../core/utils/currency_formatter.dart';
import '../../core/utils/date_formatter.dart';
import '../../shared/widgets/financial_card.dart';
import '../../shared/widgets/status_badge.dart';

class TransactionDetailScreen extends StatefulWidget {
  final String transactionId;

  const TransactionDetailScreen({super.key, required this.transactionId});

  @override
  State<TransactionDetailScreen> createState() => _TransactionDetailScreenState();
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
      final res = await apiClient.get('${ApiEndpoints.transactions}/${widget.transactionId}');
      if (res.statusCode == 200 && res.data['success'] == true) {
        setState(() {
          _transaction = TransactionModel.fromJson(res.data['data']);
          _isLoading = false;
        });
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
        content: const Text('This will atomically reverse the amount from your account balance.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
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
        await apiClient.delete('${ApiEndpoints.transactions}/${widget.transactionId}');
        if (mounted) {
          context.pop();
        }
      } catch (_) {}
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    final tx = _transaction;
    if (tx == null) {
      return Scaffold(
        appBar: AppBar(),
        body: const Center(child: Text('Transaction not found')),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Transaction Details'),
        actions: [
          IconButton(
            icon: const Icon(Icons.delete_outline_rounded, color: AppColors.expense),
            onPressed: _handleDelete,
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Center(
              child: Column(
                children: [
                  Container(
                    width: 64,
                    height: 64,
                    decoration: BoxDecoration(
                      color: tx.isIncome ? AppColors.incomeBadgeBg : AppColors.expenseBadgeBg,
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      tx.isIncome ? Icons.arrow_downward_rounded : Icons.arrow_upward_rounded,
                      size: 30,
                      color: tx.isIncome ? AppColors.income : AppColors.expense,
                    ),
                  ),
                  const SizedBox(height: 14),
                  Text(
                    '${tx.isIncome ? "+" : "-"}${CurrencyFormatter.format(tx.amount)}',
                    style: TextStyle(
                      fontSize: 32,
                      fontWeight: FontWeight.w800,
                      color: tx.isIncome ? AppColors.income : AppColors.darkTextPrimary,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    tx.merchant ?? tx.description ?? 'Merchant',
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 8),
                  StatusBadge(
                    label: tx.isIncome ? 'Credit / Income' : 'Debit / Expense',
                    color: tx.isIncome ? AppColors.income : AppColors.expense,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 32),
            FinancialCard(
              child: Column(
                children: [
                  _buildDetailRow('Category', tx.categoryName),
                  const Divider(height: 24),
                  _buildDetailRow('Date & Time', DateFormatter.formatWithTime(tx.date)),
                  const Divider(height: 24),
                  _buildDetailRow('Account', tx.accountName ?? 'Primary Account'),
                  const Divider(height: 24),
                  _buildDetailRow('Payment Mode', tx.paymentMethod ?? 'UPI / Bank Transfer'),
                  if (tx.description != null && tx.description!.isNotEmpty) ...[
                    const Divider(height: 24),
                    _buildDetailRow('Description', tx.description!),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDetailRow(String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: const TextStyle(fontSize: 13.5, color: AppColors.darkTextSecondary)),
        Text(value, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
      ],
    );
  }
}
