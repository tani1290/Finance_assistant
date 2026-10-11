import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/models/budget_model.dart';
import '../../core/utils/currency_formatter.dart';
import '../../shared/widgets/empty_state_view.dart';
import '../../shared/widgets/financial_card.dart';

class BudgetsScreen extends StatefulWidget {
  const BudgetsScreen({super.key});

  @override
  State<BudgetsScreen> createState() => _BudgetsScreenState();
}

class _BudgetsScreenState extends State<BudgetsScreen> {
  bool _isLoading = true;
  List<BudgetModel> _budgets = [];

  @override
  void initState() {
    super.initState();
    _fetchBudgets();
  }

  Future<void> _fetchBudgets() async {
    setState(() => _isLoading = true);
    try {
      final res = await apiClient.get(ApiEndpoints.budgets);
      if (res.statusCode == 200 && res.data['success'] == true) {
        final list = (res.data['data'] as List)
            .map((json) => BudgetModel.fromJson(json))
            .toList();
        setState(() {
          _budgets = list;
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
        title: const Text('Budget Overview'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _fetchBudgets,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _budgets.isEmpty
              ? EmptyStateView(
                  icon: Icons.pie_chart_outline_rounded,
                  title: 'No Budgets Configured',
                  description: 'Set monthly limits on your dining, groceries, and shopping to stay on track.',
                )
              : RefreshIndicator(
                  onRefresh: _fetchBudgets,
                  child: ListView.builder(
                    padding: const EdgeInsets.all(18),
                    itemCount: _budgets.length,
                    itemBuilder: (context, index) {
                      final b = _budgets[index];
                      final pct = b.percentage;
                      final isOver = b.isOverBudget;

                      return Padding(
                        padding: const EdgeInsets.only(bottom: 14),
                        child: FinancialCard(
                          padding: const EdgeInsets.all(18),
                          onTap: () => context.push('/budgets/${b.id}?category=${Uri.encodeComponent(b.categoryName)}'),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    b.categoryName,
                                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                                  ),
                                  Text(
                                    '${(pct * 100).toStringAsFixed(0)}%',
                                    style: TextStyle(
                                      fontSize: 14,
                                      fontWeight: FontWeight.w700,
                                      color: isOver ? AppColors.expense : AppColors.primaryLight,
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 10),
                              ClipRRect(
                                borderRadius: BorderRadius.circular(6),
                                child: LinearProgressIndicator(
                                  value: pct,
                                  minHeight: 8,
                                  backgroundColor: AppColors.darkBorderSubtle,
                                  valueColor: AlwaysStoppedAnimation<Color>(
                                    isOver ? AppColors.expense : (pct > 0.8 ? AppColors.warning : AppColors.primaryLight),
                                  ),
                                ),
                              ),
                              const SizedBox(height: 12),
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    'Spent: ${CurrencyFormatter.format(b.spent)}',
                                    style: const TextStyle(fontSize: 12.5, color: AppColors.darkTextSecondary),
                                  ),
                                  Text(
                                    'Limit: ${CurrencyFormatter.format(b.monthlyLimit)}',
                                    style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}
