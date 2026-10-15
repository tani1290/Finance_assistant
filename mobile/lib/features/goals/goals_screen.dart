import 'package:flutter/material.dart';
import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/models/goal_model.dart';
import '../../core/utils/currency_formatter.dart';
import '../../shared/widgets/empty_state_view.dart';
import '../../shared/widgets/financial_card.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/skeleton_loader.dart';

class GoalsScreen extends StatefulWidget {
  const GoalsScreen({super.key});

  @override
  State<GoalsScreen> createState() => _GoalsScreenState();
}

class _GoalsScreenState extends State<GoalsScreen> {
  bool _isLoading = true;
  List<GoalModel> _goals = [];

  @override
  void initState() {
    super.initState();
    _fetchGoals();
  }

  Future<void> _fetchGoals() async {
    setState(() => _isLoading = true);
    try {
      final res = await apiClient.get(ApiEndpoints.goals);
      if (res.statusCode == 200 && res.data['success'] == true) {
        final list = (res.data['data'] as List)
            .map((json) => GoalModel.fromJson(json))
            .toList();
        setState(() {
          _goals = list;
          _isLoading = false;
        });
      } else {
        setState(() => _isLoading = false);
      }
    } catch (_) {
      setState(() => _isLoading = false);
    }
  }

  void _showAddGoalDialog() {
    final nameController = TextEditingController();
    final targetController = TextEditingController();

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text(
          'Add Savings Goal',
          style: TextStyle(fontWeight: FontWeight.w700, fontSize: 17),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: nameController,
              decoration: const InputDecoration(
                labelText: 'Goal Name (e.g. Emergency Fund)',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: targetController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Target Amount (₹)'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () async {
              if (nameController.text.trim().isEmpty) return;
              Navigator.pop(ctx);
              try {
                await apiClient.post(
                  ApiEndpoints.goals,
                  data: {
                    'name': nameController.text.trim(),
                    'targetAmount':
                        double.tryParse(targetController.text) ?? 100000,
                    'currentAmount': 0,
                  },
                );
                _fetchGoals();
              } catch (_) {}
            },
            child: const Text('Create Goal'),
          ),
        ],
      ),
    );
  }

  void _showContributeDialog(GoalModel goal) {
    final amountController = TextEditingController(text: '5000');

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(
          'Add to ${goal.name}',
          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17),
        ),
        content: TextField(
          controller: amountController,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(
            labelText: 'Contribution Amount (₹)',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () async {
              final amt = double.tryParse(amountController.text) ?? 0;
              if (amt <= 0) return;
              Navigator.pop(ctx);
              try {
                await apiClient.patch(
                  '${ApiEndpoints.goals}/${goal.id}/contribute',
                  data: {'amount': amt},
                );
                _fetchGoals();
              } catch (_) {}
            },
            child: const Text('Contribute'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Financial Goals'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add_rounded),
            onPressed: _showAddGoalDialog,
          ),
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _fetchGoals,
          ),
        ],
      ),
      body: _isLoading
          ? _buildSkeleton()
          : _goals.isEmpty
          ? EmptyStateView(
              icon: Icons.flag_rounded,
              title: 'No Goals Set Yet',
              description:
                  'Create an emergency fund or milestone savings goal to track your progress.',
              actionLabel: 'Create a Goal',
              onAction: _showAddGoalDialog,
            )
          : RefreshIndicator(
              onRefresh: _fetchGoals,
              child: ListView.builder(
                padding: const EdgeInsets.fromLTRB(18, 18, 18, 32),
                itemCount: _goals.length,
                itemBuilder: (context, index) => Padding(
                  padding: const EdgeInsets.only(bottom: 14),
                  child: _GoalCard(
                    goal: _goals[index],
                    onContribute: () => _showContributeDialog(_goals[index]),
                  ),
                ),
              ),
            ),
    );
  }

  Widget _buildSkeleton() {
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 32),
      itemCount: 4,
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
                  SkeletonLoader(width: 150, height: 16),
                  SkeletonLoader(width: 40, height: 16),
                ],
              ),
              SizedBox(height: 16),
              SkeletonLoader(width: double.infinity, height: 8, borderRadius: 6),
              SizedBox(height: 16),
              SkeletonLoader(width: 100, height: 12),
              SizedBox(height: 18),
              SkeletonLoader(width: double.infinity, height: 42, borderRadius: 12),
            ],
          ),
        ),
      ),
    );
  }
}

class _GoalCard extends StatelessWidget {
  final GoalModel goal;
  final VoidCallback onContribute;

  const _GoalCard({required this.goal, required this.onContribute});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final progress = goal.progress.clamp(0.0, 1.0);
    final isComplete = goal.progress >= 1.0;

    return FinancialCard(
      padding: const EdgeInsets.all(18),
      accent: isComplete ? AppColors.income : AppColors.primary,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  goal.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary(isDark),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: (isComplete ? AppColors.income : AppColors.primaryLight)
                      .withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  '${(goal.progress * 100).toStringAsFixed(0)}%',
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                    color: isComplete
                        ? AppColors.income
                        : AppColors.primaryLight,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: TweenAnimationBuilder<double>(
              tween: Tween(begin: 0, end: progress),
              duration: const Duration(milliseconds: 650),
              curve: Curves.easeOutCubic,
              builder: (context, value, _) => LinearProgressIndicator(
                value: value,
                minHeight: 8,
                backgroundColor: AppColors.surfaceSubtle(isDark),
                valueColor: AlwaysStoppedAnimation<Color>(
                  isComplete ? AppColors.income : AppColors.primaryLight,
                ),
              ),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Saved ${CurrencyFormatter.format(goal.currentAmount)}',
                style: TextStyle(
                  fontSize: 12.5,
                  color: AppColors.textSecondary(isDark),
                ),
              ),
              Text(
                'Target ${CurrencyFormatter.format(goal.targetAmount)}',
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textPrimary(isDark),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Pressable(
            onTap: onContribute,
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 12),
              decoration: BoxDecoration(
                color: AppColors.primary.withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: AppColors.primary.withValues(alpha: 0.35),
                ),
              ),
              child: const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.add_circle_outline_rounded,
                    size: 17,
                    color: AppColors.primaryLight,
                  ),
                  SizedBox(width: 8),
                  Text(
                    'Add Funds to Goal',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: AppColors.primaryLight,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
