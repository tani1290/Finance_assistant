import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/models/budget_model.dart';
import '../../core/utils/currency_formatter.dart';
import '../../shared/widgets/empty_state_view.dart';
import '../../shared/widgets/financial_card.dart';
import '../../shared/widgets/skeleton_loader.dart';

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
          ? _buildSkeletonList()
          : _budgets.isEmpty
          ? EmptyStateView(
              icon: Icons.pie_chart_outline_rounded,
              title: 'No Budgets Configured',
              description:
                  'Set monthly limits on your dining, groceries, and shopping to stay on track.',
            )
          : RefreshIndicator(
              onRefresh: _fetchBudgets,
              child: ListView.builder(
                padding: const EdgeInsets.fromLTRB(18, 18, 18, 28),
                itemCount: _budgets.length,
                itemBuilder: (context, index) => Padding(
                  padding: const EdgeInsets.only(bottom: 14),
                  child: _BudgetCard(budget: _budgets[index], isDark: isDark),
                ),
              ),
            ),
    );
  }

  Widget _buildSkeletonList() {
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 28),
      itemCount: 5,
      itemBuilder: (context, index) => Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: const FinancialCard(
          padding: EdgeInsets.all(18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  SkeletonLoader(width: 130, height: 16),
                  SkeletonLoader(width: 42, height: 16),
                ],
              ),
              SizedBox(height: 16),
              SkeletonLoader(width: double.infinity, height: 8, borderRadius: 6),
              SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  SkeletonLoader(width: 96, height: 12),
                  SkeletonLoader(width: 96, height: 12),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _BudgetCard extends StatelessWidget {
  final BudgetModel budget;
  final bool isDark;

  const _BudgetCard({required this.budget, required this.isDark});

  @override
  Widget build(BuildContext context) {
    final rawPct = budget.percentage;
    final isOver = budget.isOverBudget;
    final barColor = isOver
        ? AppColors.expense
        : (rawPct > 0.8 ? AppColors.warning : AppColors.primaryLight);

    return FinancialCard(
      padding: const EdgeInsets.all(18),
      onTap: () => context.push(
        '/budgets/${budget.id}?category=${Uri.encodeComponent(budget.categoryName)}',
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                budget.categoryName,
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary(isDark),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: barColor.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  '${(rawPct * 100).toStringAsFixed(0)}%',
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                    color: barColor,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: TweenAnimationBuilder<double>(
              tween: Tween(begin: 0, end: rawPct.clamp(0.0, 1.0)),
              duration: const Duration(milliseconds: 650),
              curve: Curves.easeOutCubic,
              builder: (context, value, _) => LinearProgressIndicator(
                value: value,
                minHeight: 8,
                backgroundColor: AppColors.surfaceSubtle(isDark),
                valueColor: AlwaysStoppedAnimation<Color>(barColor),
              ),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Spent ${CurrencyFormatter.format(budget.spent)}',
                style: TextStyle(
                  fontSize: 12.5,
                  color: AppColors.textSecondary(isDark),
                ),
              ),
              Text(
                'of ${CurrencyFormatter.format(budget.monthlyLimit)}',
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textPrimary(isDark),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
