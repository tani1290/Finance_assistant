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
import '../../shared/widgets/transaction_tile.dart';

class CategoryDetailScreen extends StatefulWidget {
  final String budgetId;
  final String categoryName;

  const CategoryDetailScreen({
    super.key,
    required this.budgetId,
    required this.categoryName,
  });

  @override
  State<CategoryDetailScreen> createState() => _CategoryDetailScreenState();
}

class _CategoryDetailScreenState extends State<CategoryDetailScreen> {
  bool _isLoading = true;
  List<TransactionModel> _categoryTransactions = [];

  @override
  void initState() {
    super.initState();
    _fetchCategoryTransactions();
  }

  Future<void> _fetchCategoryTransactions() async {
    try {
      final res = await apiClient.get(ApiEndpoints.transactions);
      if (res.statusCode == 200 && res.data['success'] == true) {
        final list =
            (res.data['data']['transactions'] ?? res.data['data'] as List)
                .map((json) => TransactionModel.fromJson(json))
                .where(
                  (t) =>
                      t.categoryName.toLowerCase() ==
                      widget.categoryName.toLowerCase(),
                )
                .toList();

        setState(() {
          _categoryTransactions = list;
          _isLoading = false;
        });
      } else {
        setState(() => _isLoading = false);
      }
    } catch (_) {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final total = _categoryTransactions.fold<double>(
      0,
      (sum, t) => sum + t.amount,
    );

    return Scaffold(
      appBar: AppBar(title: Text(widget.categoryName)),
      body: _isLoading
          ? _buildSkeleton()
          : _categoryTransactions.isEmpty
          ? EmptyStateView(
              icon: Icons.receipt_long_rounded,
              title: 'No Transactions',
              description:
                  'No expenses recorded in ${widget.categoryName} this month.',
            )
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
              children: [
                Padding(
                  padding: const EdgeInsets.only(left: 4, bottom: 14),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        '${_categoryTransactions.length} '
                        '${_categoryTransactions.length == 1 ? "entry" : "entries"}',
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textSecondary(isDark),
                        ),
                      ),
                      Text(
                        '-${CurrencyFormatter.format(total)}',
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                          color: AppColors.expense,
                        ),
                      ),
                    ],
                  ),
                ),
                ..._categoryTransactions.map(
                  (tx) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: TransactionTile(
                      tx: tx,
                      subtitle:
                          '${DateFormatter.format(tx.date)} • ${tx.paymentMethod ?? "UPI"}',
                      onTap: () => context.push('/transactions/${tx.id}'),
                    ),
                  ),
                ),
              ],
            ),
    );
  }

  Widget _buildSkeleton() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
      children: [
        for (var i = 0; i < 6; i++) ...[
          const FinancialCard(
            padding: EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: Row(
              children: [
                SkeletonLoader(width: 34, height: 34, borderRadius: 17),
                SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SkeletonLoader(width: 150, height: 13),
                      SizedBox(height: 7),
                      SkeletonLoader(width: 100, height: 11),
                    ],
                  ),
                ),
                SkeletonLoader(width: 64, height: 14),
              ],
            ),
          ),
          const SizedBox(height: 10),
        ],
      ],
    );
  }
}
