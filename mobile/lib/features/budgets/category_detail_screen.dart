import 'package:flutter/material.dart';
import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/models/transaction_model.dart';
import '../../core/utils/currency_formatter.dart';
import '../../core/utils/date_formatter.dart';
import '../../shared/widgets/empty_state_view.dart';
import '../../shared/widgets/financial_card.dart';

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
        final list = (res.data['data']['transactions'] ?? res.data['data'] as List)
            .map((json) => TransactionModel.fromJson(json))
            .where((t) => t.categoryName.toLowerCase() == widget.categoryName.toLowerCase())
            .toList();

        setState(() {
          _categoryTransactions = list;
          _isLoading = false;
        });
      }
    } catch (_) {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.categoryName),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _categoryTransactions.isEmpty
              ? EmptyStateView(
                  icon: Icons.receipt_long_rounded,
                  title: 'No Transactions',
                  description: 'No expenses recorded in ${widget.categoryName} this month.',
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(18),
                  itemCount: _categoryTransactions.length,
                  itemBuilder: (context, index) {
                    final tx = _categoryTransactions[index];
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: FinancialCard(
                        padding: const EdgeInsets.all(16),
                        child: Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(8),
                              decoration: const BoxDecoration(
                                color: AppColors.expenseBadgeBg,
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(Icons.arrow_upward_rounded, size: 16, color: AppColors.expense),
                            ),
                            const SizedBox(width: 14),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    tx.merchant ?? tx.description ?? 'Expense',
                                    style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
                                  ),
                                  Text(
                                    DateFormatter.format(tx.date),
                                    style: const TextStyle(fontSize: 12, color: AppColors.darkTextSecondary),
                                  ),
                                ],
                              ),
                            ),
                            Text(
                              '-${CurrencyFormatter.format(tx.amount)}',
                              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
    );
  }
}
