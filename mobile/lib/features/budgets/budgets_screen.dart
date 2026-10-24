import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/api/api_error.dart';
import '../../core/models/budget_model.dart';
import '../../core/utils/currency_formatter.dart';
import '../../shared/widgets/empty_state_view.dart';
import '../../shared/widgets/error_state_view.dart';
import '../../shared/widgets/financial_card.dart';
import '../../shared/widgets/skeleton_loader.dart';
import 'add_budget_sheet.dart';

class BudgetsScreen extends StatefulWidget {
  const BudgetsScreen({super.key});

  @override
  State<BudgetsScreen> createState() => _BudgetsScreenState();
}

class _BudgetsScreenState extends State<BudgetsScreen> {
  bool _isLoading = true;
  String? _errorMessage;
  List<BudgetModel> _budgets = [];
  double _totalLimit = 0;
  double _totalSpent = 0;

  @override
  void initState() {
    super.initState();
    _fetchBudgets();
  }

  Future<void> _fetchBudgets() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });
    try {
      final res = await apiClient.get(ApiEndpoints.budgets);
      if (res.statusCode == 200 && res.data['success'] == true) {
        // GET /budgets wraps the rows in `data.budgets` alongside period
        // summary totals; older payloads returned a bare list.
        final data = res.data['data'];
        final raw = data is Map ? data['budgets'] : data;
        if (raw is! List) {
          throw const FormatException('Budgets response missing list');
        }
        final list = raw
            .whereType<Map>()
            .map((json) => BudgetModel.fromJson(Map<String, dynamic>.from(json)))
            .toList();
        final summary = data is Map ? data['summary'] : null;
        final totalLimit =
            double.tryParse(
              (summary is Map ? summary['totalBudgeted'] : null)?.toString() ??
                  '',
            ) ??
            list.fold<double>(0, (sum, budget) => sum + budget.monthlyLimit);
        final totalSpent =
            double.tryParse(
              (summary is Map ? summary['totalSpent'] : null)?.toString() ??
                  '',
            ) ??
            list.fold<double>(0, (sum, budget) => sum + budget.spent);
        if (!mounted) return;
        setState(() {
          _budgets = list;
          _totalLimit = totalLimit;
          _totalSpent = totalSpent;
          _isLoading = false;
        });
      } else {
        if (!mounted) return;
        setState(() {
          _errorMessage = 'The server returned an unexpected response.';
          _isLoading = false;
        });
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _errorMessage =
            'Your budgets could not be loaded. Check your connection and try again.';
        _isLoading = false;
      });
    }
  }

  Future<void> _openAddBudget() async {
    await AddBudgetSheet.show(
      context,
      onCreated: (message) {
        if (!mounted) return;
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(message)));
        _fetchBudgets();
      },
    );
  }

  /// Budget delete is destructive and irreversible, so it always requires an
  /// explicit confirmation before the request is sent.
  Future<void> _deleteBudget(BudgetModel budget) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete budget?'),
        content: Text(
          'Remove the monthly limit for ${budget.categoryName}? '
          'Past transactions are not affected.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    try {
      await apiClient.delete(ApiEndpoints.budget(budget.id));
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Budget deleted.')),
      );
      _fetchBudgets();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            apiErrorMessage(error) ??
                'Budget could not be deleted. Check your connection.',
          ),
        ),
      );
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
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _openAddBudget,
        icon: const Icon(Icons.add_rounded),
        label: const Text('Add'),
      ),
      body: _isLoading
          ? _buildSkeletonList()
          : _errorMessage != null
          ? ErrorStateView(message: _errorMessage!, onRetry: _fetchBudgets)
          : _budgets.isEmpty
          ? EmptyStateView(
              icon: Icons.pie_chart_outline_rounded,
              title: 'No Budgets Configured',
              description:
                  'Set monthly limits on your dining, groceries, and shopping to stay on track.',
            )
          : RefreshIndicator(
              onRefresh: _fetchBudgets,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(18, 18, 18, 28),
                children: [
                  _BudgetSummary(
                    totalLimit: _totalLimit,
                    totalSpent: _totalSpent,
                    isDark: isDark,
                  ),
                  const SizedBox(height: 14),
                  for (final budget in _budgets)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 14),
                      child: _BudgetCard(
                        budget: budget,
                        isDark: isDark,
                        onDelete: () => _deleteBudget(budget),
                      ),
                    ),
                ],
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

class _BudgetSummary extends StatelessWidget {
  final double totalLimit;
  final double totalSpent;
  final bool isDark;

  const _BudgetSummary({
    required this.totalLimit,
    required this.totalSpent,
    required this.isDark,
  });

  @override
  Widget build(BuildContext context) {
    final remaining = totalLimit - totalSpent;
    final isOver = remaining < 0;

    return FinancialCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'This month',
            style: TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
              color: AppColors.textSecondary(isDark),
            ),
          ),
          const SizedBox(height: 6),
          Text(
            CurrencyFormatter.format(totalSpent),
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary(isDark),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'spent of ${CurrencyFormatter.format(totalLimit)} '
            '(${isOver ? 'over' : 'remaining'} '
            '${CurrencyFormatter.format(remaining.abs())})',
            style: TextStyle(
              fontSize: 13,
              color: isOver ? AppColors.expense : AppColors.textSecondary(isDark),
            ),
          ),
        ],
      ),
    );
  }
}

class _BudgetCard extends StatelessWidget {
  final BudgetModel budget;
  final bool isDark;
  final VoidCallback onDelete;

  const _BudgetCard({
    required this.budget,
    required this.isDark,
    required this.onDelete,
  });

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
            children: [
              Expanded(
                child: Text(
                  budget.categoryName,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary(isDark),
                  ),
                ),
              ),
              const SizedBox(width: 8),
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
              PopupMenuButton<String>(
                tooltip: 'Budget options',
                padding: EdgeInsets.zero,
                onSelected: (value) {
                  if (value == 'delete') onDelete();
                },
                itemBuilder: (_) => const [
                  PopupMenuItem<String>(
                    value: 'delete',
                    child: Text('Delete budget'),
                  ),
                ],
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
