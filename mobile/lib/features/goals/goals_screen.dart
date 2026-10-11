import 'package:flutter/material.dart';
import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/models/goal_model.dart';
import '../../core/utils/currency_formatter.dart';
import '../../shared/widgets/empty_state_view.dart';
import '../../shared/widgets/financial_card.dart';

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
        title: const Text('Add Savings Goal', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 17)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(controller: nameController, decoration: const InputDecoration(labelText: 'Goal Name (e.g. Emergency Fund)')),
            const SizedBox(height: 12),
            TextField(controller: targetController, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Target Amount (₹)')),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () async {
              if (nameController.text.trim().isEmpty) return;
              Navigator.pop(ctx);
              try {
                await apiClient.post(ApiEndpoints.goals, data: {
                  'name': nameController.text.trim(),
                  'targetAmount': double.tryParse(targetController.text) ?? 100000,
                  'currentAmount': 0,
                });
                _fetchGoals();
              } catch (_) {}
            },
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.primary),
            child: const Text('Create Goal', style: TextStyle(color: Colors.white)),
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
        title: Text('Add to ${goal.name}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17)),
        content: TextField(
          controller: amountController,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'Contribution Amount (₹)'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () async {
              final amt = double.tryParse(amountController.text) ?? 0;
              if (amt <= 0) return;
              Navigator.pop(ctx);
              try {
                await apiClient.patch('${ApiEndpoints.goals}/${goal.id}/contribute', data: {'amount': amt});
                _fetchGoals();
              } catch (_) {}
            },
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.primary),
            child: const Text('Contribute', style: TextStyle(color: Colors.white)),
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
          IconButton(icon: const Icon(Icons.add_rounded), onPressed: _showAddGoalDialog),
          IconButton(icon: const Icon(Icons.refresh_rounded), onPressed: _fetchGoals),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _goals.isEmpty
              ? EmptyStateView(
                  icon: Icons.flag_rounded,
                  title: 'No Goals Set Yet',
                  description: 'Create an emergency fund or milestone savings goal to track your progress.',
                  actionLabel: 'Create a Goal',
                  onAction: _showAddGoalDialog,
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(18),
                  itemCount: _goals.length,
                  itemBuilder: (context, index) {
                    final goal = _goals[index];
                    final progress = goal.progress;

                    return Padding(
                      padding: const EdgeInsets.only(bottom: 14),
                      child: FinancialCard(
                        padding: const EdgeInsets.all(18),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(goal.name, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                                Text(
                                  '${(progress * 100).toStringAsFixed(0)}%',
                                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.primaryLight),
                                ),
                              ],
                            ),
                            const SizedBox(height: 10),
                            ClipRRect(
                              borderRadius: BorderRadius.circular(6),
                              child: LinearProgressIndicator(
                                value: progress,
                                minHeight: 8,
                                backgroundColor: AppColors.darkBorderSubtle,
                                valueColor: const AlwaysStoppedAnimation<Color>(AppColors.primaryLight),
                              ),
                            ),
                            const SizedBox(height: 12),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  'Saved: ${CurrencyFormatter.format(goal.currentAmount)}',
                                  style: const TextStyle(fontSize: 12.5, color: AppColors.darkTextSecondary),
                                ),
                                Text(
                                  'Target: ${CurrencyFormatter.format(goal.targetAmount)}',
                                  style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
                                ),
                              ],
                            ),
                            const SizedBox(height: 14),
                            SizedBox(
                              width: double.infinity,
                              child: OutlinedButton.icon(
                                icon: const Icon(Icons.add_circle_outline_rounded, size: 16),
                                label: const Text('Add Funds to Goal'),
                                onPressed: () => _showContributeDialog(goal),
                                style: OutlinedButton.styleFrom(
                                  side: const BorderSide(color: AppColors.darkBorder),
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                                ),
                              ),
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
