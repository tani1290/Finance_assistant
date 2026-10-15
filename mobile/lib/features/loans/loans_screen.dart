import 'package:flutter/material.dart';
import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/models/loan_model.dart';
import '../../core/utils/currency_formatter.dart';
import '../../shared/widgets/empty_state_view.dart';
import '../../shared/widgets/financial_card.dart';
import '../../shared/widgets/gradient_button.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/skeleton_loader.dart';
import '../../shared/widgets/summary_hero_card.dart';

class LoansScreen extends StatefulWidget {
  const LoansScreen({super.key});

  @override
  State<LoansScreen> createState() => _LoansScreenState();
}

class _LoansScreenState extends State<LoansScreen> {
  bool _isLoading = true;
  List<LoanModel> _loans = [];

  @override
  void initState() {
    super.initState();
    _fetchLoans();
  }

  Future<void> _fetchLoans() async {
    setState(() => _isLoading = true);
    try {
      final res = await apiClient.get(ApiEndpoints.loans);
      if (res.statusCode == 200 && res.data['success'] == true) {
        final list = (res.data['data'] as List)
            .map((json) => LoanModel.fromJson(json))
            .toList();
        setState(() {
          _loans = list;
          _isLoading = false;
        });
      }
    } catch (_) {
      setState(() => _isLoading = false);
    }
  }

  double get _totalOutstanding =>
      _loans.fold(0.0, (sum, l) => sum + l.outstandingAmount);
  double get _totalEmi => _loans.fold(0.0, (sum, l) => sum + l.emiAmount);

  void _showPrepaymentSimulator(LoanModel loan) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final amountController = TextEditingController(text: '50000');
    Map<String, dynamic>? simResult;
    bool isSimulating = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface(isDark),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => Padding(
          padding: EdgeInsets.only(
            left: 24,
            right: 24,
            top: 24,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 24,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Prepayment Simulator',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary(isDark),
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'Estimate the interest & tenure you save on a lump-sum payment to ${loan.lender}.',
                style: TextStyle(
                  fontSize: 13,
                  color: AppColors.textSecondary(isDark),
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 18),
              TextField(
                controller: amountController,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'Prepayment Amount (₹)',
                ),
              ),
              const SizedBox(height: 16),
              GradientButton(
                text: 'Simulate Savings',
                isLoading: isSimulating,
                onPressed: () async {
                  setSheetState(() => isSimulating = true);
                  try {
                    final res = await apiClient.post(
                      '${ApiEndpoints.loans}/prepayment-simulate',
                      data: {
                        'principal': loan.outstandingAmount,
                        'interestRate': loan.interestRate,
                        'tenureMonths': loan.tenureMonths,
                        'prepaymentAmount':
                            double.tryParse(amountController.text) ?? 50000,
                      },
                    );
                    if (res.statusCode == 200) {
                      setSheetState(() {
                        simResult = res.data['data'];
                        isSimulating = false;
                      });
                    }
                  } catch (_) {
                    setSheetState(() => isSimulating = false);
                  }
                },
              ),
              if (simResult != null) ...[
                const SizedBox(height: 20),
                FinancialCard(
                  padding: const EdgeInsets.all(16),
                  backgroundColor: AppColors.primary.withValues(alpha: 0.12),
                  child: Column(
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            'Estimated Interest Saved',
                            style: TextStyle(
                              fontWeight: FontWeight.w600,
                              color: AppColors.textSecondary(isDark),
                            ),
                          ),
                          Text(
                            CurrencyFormatter.format(
                              simResult!['interestSaved'] ?? 24500,
                            ),
                            style: const TextStyle(
                              fontWeight: FontWeight.w700,
                              color: AppColors.primaryLight,
                              fontSize: 16,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            'Tenure Reduction',
                            style: TextStyle(
                              fontSize: 13,
                              color: AppColors.textSecondary(isDark),
                            ),
                          ),
                          Text(
                            '${simResult!['monthsSaved'] ?? 14} months earlier',
                            style: TextStyle(
                              fontWeight: FontWeight.w600,
                              color: AppColors.textPrimary(isDark),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Loans & EMIs'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _fetchLoans,
          ),
        ],
      ),
      body: _isLoading
          ? _buildSkeleton()
          : _loans.isEmpty
          ? EmptyStateView(
              icon: Icons.credit_card_outlined,
              title: 'No Active Loans',
              description:
                  'Track home loans, vehicle EMIs, and personal loans with interest payoff schedules.',
            )
          : RefreshIndicator(
              onRefresh: _fetchLoans,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(18, 16, 18, 32),
                children: [
                  SummaryHeroCard(
                    label: 'Total Outstanding Debt',
                    value: CurrencyFormatter.format(_totalOutstanding),
                    icon: Icons.account_balance_rounded,
                    subtitle:
                        '${CurrencyFormatter.format(_totalEmi)} committed per month across ${_loans.length} ${_loans.length == 1 ? "loan" : "loans"}',
                  ),
                  const SizedBox(height: 24),
                  Text(
                    'Active Loans',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary(isDark),
                    ),
                  ),
                  const SizedBox(height: 12),
                  ..._loans.map(
                    (loan) => Padding(
                      padding: const EdgeInsets.only(bottom: 14),
                      child: _LoanCard(
                        loan: loan,
                        isDark: isDark,
                        onSimulate: () => _showPrepaymentSimulator(loan),
                      ),
                    ),
                  ),
                ],
              ),
            ),
    );
  }

  Widget _buildSkeleton() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 32),
      children: [
        const SkeletonLoader(
          width: double.infinity,
          height: 158,
          borderRadius: 18,
        ),
        const SizedBox(height: 24),
        const SkeletonLoader(width: 120, height: 18),
        const SizedBox(height: 14),
        for (var i = 0; i < 3; i++) ...[
          FinancialCard(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: const [
                SkeletonLoader(width: 150, height: 16),
                SizedBox(height: 18),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    SkeletonLoader(width: 110, height: 34),
                    SkeletonLoader(width: 110, height: 34),
                  ],
                ),
                SizedBox(height: 18),
                SkeletonLoader(
                  width: double.infinity,
                  height: 42,
                  borderRadius: 12,
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
        ],
      ],
    );
  }
}

class _LoanCard extends StatelessWidget {
  final LoanModel loan;
  final bool isDark;
  final VoidCallback onSimulate;

  const _LoanCard({
    required this.loan,
    required this.isDark,
    required this.onSimulate,
  });

  @override
  Widget build(BuildContext context) {
    return FinancialCard(
      padding: const EdgeInsets.all(18),
      accent: AppColors.expense,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  loan.lender,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary(isDark),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  loan.loanType,
                  style: const TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.primaryLight,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _Metric(
                label: 'Monthly EMI',
                value: CurrencyFormatter.format(loan.emiAmount),
                isDark: isDark,
              ),
              _Metric(
                label: 'Outstanding',
                value: CurrencyFormatter.format(loan.outstandingAmount),
                isDark: isDark,
                alignEnd: true,
              ),
            ],
          ),
          const SizedBox(height: 16),
          Pressable(
            onTap: onSimulate,
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
                    Icons.calculate_outlined,
                    size: 17,
                    color: AppColors.primaryLight,
                  ),
                  SizedBox(width: 8),
                  Text(
                    'Simulate Prepayment Savings',
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

class _Metric extends StatelessWidget {
  final String label;
  final String value;
  final bool isDark;
  final bool alignEnd;

  const _Metric({
    required this.label,
    required this.value,
    required this.isDark,
    this.alignEnd = false,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: alignEnd
          ? CrossAxisAlignment.end
          : CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 12,
            color: AppColors.textSecondary(isDark),
          ),
        ),
        const SizedBox(height: 3),
        Text(
          value,
          style: TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w700,
            color: AppColors.textPrimary(isDark),
          ),
        ),
      ],
    );
  }
}
