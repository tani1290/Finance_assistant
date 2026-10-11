import 'package:flutter/material.dart';
import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/models/loan_model.dart';
import '../../core/utils/currency_formatter.dart';
import '../../shared/widgets/empty_state_view.dart';
import '../../shared/widgets/financial_card.dart';
import '../../shared/widgets/gradient_button.dart';

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

  void _showPrepaymentSimulator(LoanModel loan) {
    final amountController = TextEditingController(text: '50000');
    Map<String, dynamic>? simResult;
    bool isSimulating = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
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
              Text('Prepayment Simulator: ${loan.lender}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
              const SizedBox(height: 6),
              const Text('Calculate interest & tenure reduction from a lump-sum payment:', style: TextStyle(fontSize: 13, color: AppColors.darkTextSecondary)),
              const SizedBox(height: 16),
              TextField(
                controller: amountController,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Prepayment Amount (₹)'),
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
                        'prepaymentAmount': double.tryParse(amountController.text) ?? 50000,
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
                          const Text('Estimated Interest Saved:', style: TextStyle(fontWeight: FontWeight.w600)),
                          Text(
                            CurrencyFormatter.format(simResult!['interestSaved'] ?? 24500),
                            style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.primaryLight, fontSize: 16),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text('Tenure Reduction:', style: TextStyle(fontSize: 13)),
                          Text('${simResult!['monthsSaved'] ?? 14} Months earlier', style: const TextStyle(fontWeight: FontWeight.w600)),
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
    return Scaffold(
      appBar: AppBar(
        title: const Text('Loans & EMIs'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh_rounded), onPressed: _fetchLoans),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _loans.isEmpty
              ? EmptyStateView(
                  icon: Icons.credit_card_outlined,
                  title: 'No Active Loans',
                  description: 'Track home loans, vehicle EMIs, and personal loans with interest payoff schedules.',
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(18),
                  itemCount: _loans.length,
                  itemBuilder: (context, index) {
                    final loan = _loans[index];

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
                                Text(loan.lender, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                                Text(
                                  loan.loanType,
                                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.primaryLight),
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text('Monthly EMI', style: TextStyle(fontSize: 12, color: AppColors.darkTextSecondary)),
                                    const SizedBox(height: 2),
                                    Text(
                                      CurrencyFormatter.format(loan.emiAmount),
                                      style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
                                    ),
                                  ],
                                ),
                                Column(
                                  crossAxisAlignment: CrossAxisAlignment.end,
                                  children: [
                                    const Text('Outstanding Balance', style: TextStyle(fontSize: 12, color: AppColors.darkTextSecondary)),
                                    const SizedBox(height: 2),
                                    Text(
                                      CurrencyFormatter.format(loan.outstandingAmount),
                                      style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                            const SizedBox(height: 14),
                            SizedBox(
                              width: double.infinity,
                              child: OutlinedButton.icon(
                                icon: const Icon(Icons.calculate_outlined, size: 16),
                                label: const Text('Simulate Prepayment Savings'),
                                onPressed: () => _showPrepaymentSimulator(loan),
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
