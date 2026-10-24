import 'package:flutter/material.dart';
import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/api/api_error.dart';
import '../../core/models/loan_model.dart';
import '../../core/utils/currency_formatter.dart';
import '../../shared/widgets/empty_state_view.dart';
import '../../shared/widgets/error_state_view.dart';
import '../../shared/widgets/financial_card.dart';
import '../../shared/widgets/gradient_button.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/skeleton_loader.dart';
import '../../shared/widgets/summary_hero_card.dart';
import 'add_loan_sheet.dart';

class LoansScreen extends StatefulWidget {
  const LoansScreen({super.key});

  @override
  State<LoansScreen> createState() => _LoansScreenState();
}

class _LoansScreenState extends State<LoansScreen> {
  bool _isLoading = true;
  String? _errorMessage;
  List<LoanModel> _loans = [];

  @override
  void initState() {
    super.initState();
    _fetchLoans();
  }

  Future<void> _fetchLoans() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });
    try {
      final res = await apiClient.get(ApiEndpoints.loans);
      if (res.statusCode == 200 && res.data['success'] == true) {
        final data = res.data['data'];
        // The endpoint returns an envelope (`{ totals, loans: [...] }`); accept a
        // bare list too so older responses keep working.
        final dynamic raw = data is Map ? data['loans'] : data;
        if (raw is! List) {
          throw const FormatException('Loans response missing list');
        }
        final list = raw
            .whereType<Map>()
            .map((json) => LoanModel.fromJson(Map<String, dynamic>.from(json)))
            .toList();
        if (!mounted) return;
        setState(() {
          _loans = list;
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
            'Your loans could not be loaded. Check your connection and try again.';
        _isLoading = false;
      });
    }
  }

  double get _totalOutstanding =>
      _loans.fold(0.0, (sum, l) => sum + l.outstandingAmount);
  double get _totalEmi => _loans.fold(0.0, (sum, l) => sum + l.emiAmount);

  void _showPrepaymentSimulator(LoanModel loan) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final amountController = TextEditingController();
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
                  final prepayment = double.tryParse(
                    amountController.text.trim(),
                  );
                  if (prepayment == null || prepayment <= 0) {
                    ScaffoldMessenger.of(ctx).showSnackBar(
                      const SnackBar(
                        content: Text('Enter a valid prepayment amount.'),
                      ),
                    );
                    return;
                  }

                  setSheetState(() => isSimulating = true);
                  try {
                    final res = await apiClient.post(
                      '${ApiEndpoints.loans}/prepayment-simulate',
                      data: {
                        'principal': loan.outstandingAmount,
                        'interestRate': loan.interestRate,
                        'tenureMonths': loan.tenureMonths,
                        'prepaymentAmount': prepayment,
                      },
                    );
                    if (!ctx.mounted) return;
                    if (res.statusCode == 200) {
                      setSheetState(() {
                        simResult = res.data['data'];
                        isSimulating = false;
                      });
                    } else {
                      setSheetState(() => isSimulating = false);
                      ScaffoldMessenger.of(ctx).showSnackBar(
                        const SnackBar(
                          content: Text(
                            'The simulation could not be calculated. Please try again.',
                          ),
                        ),
                      );
                    }
                  } catch (_) {
                    if (!ctx.mounted) return;
                    setSheetState(() => isSimulating = false);
                    ScaffoldMessenger.of(ctx).showSnackBar(
                      const SnackBar(
                        content: Text(
                          'The simulation could not be calculated. Please try again.',
                        ),
                      ),
                    );
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
                            simResult!['interestSaved'] == null
                                ? '—'
                                : CurrencyFormatter.format(
                                    double.tryParse(
                                      simResult!['interestSaved'].toString(),
                                    ),
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
                            simResult!['monthsSaved'] == null
                                ? '—'
                                : '${simResult!['monthsSaved']} months earlier',
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

  Future<void> _openAddLoan() async {
    await AddLoanSheet.show(
      context,
      onCreated: (message) {
        if (!mounted) return;
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(message)));
        _fetchLoans();
      },
    );
  }

  /// Loan deletion is irreversible, so it always asks for explicit
  /// confirmation before calling `DELETE /loans/:id`.
  Future<void> _deleteLoan(LoanModel loan) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete loan?'),
        content: Text(
          'Delete the ${loan.loanType.toLowerCase()} loan'
          '${loan.lender.isEmpty ? '' : ' from ${loan.lender}'}? '
          'This removes its EMI and outstanding balance from your totals.',
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
      await apiClient.delete(ApiEndpoints.loan(loan.id));
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Loan deleted.')),
      );
      _fetchLoans();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            apiErrorMessage(error) ??
                'Loan could not be deleted. Check your connection.',
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
        title: const Text('Loans & EMIs'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _fetchLoans,
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _openAddLoan,
        icon: const Icon(Icons.add_rounded),
        label: const Text('Add'),
      ),
      body: _isLoading
          ? _buildSkeleton()
          : _errorMessage != null
          ? ErrorStateView(message: _errorMessage!, onRetry: _fetchLoans)
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
                        onDelete: () => _deleteLoan(loan),
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
  final VoidCallback onDelete;

  const _LoanCard({
    required this.loan,
    required this.isDark,
    required this.onSimulate,
    required this.onDelete,
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
              PopupMenuButton<String>(
                tooltip: 'Loan options',
                padding: EdgeInsets.zero,
                onSelected: (value) {
                  if (value == 'delete') onDelete();
                },
                itemBuilder: (_) => const [
                  PopupMenuItem<String>(
                    value: 'delete',
                    child: Text('Delete loan'),
                  ),
                ],
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
