import 'package:flutter/material.dart';
import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/models/account_model.dart';
import '../../core/utils/currency_formatter.dart';
import '../../shared/widgets/empty_state_view.dart';
import '../../shared/widgets/financial_card.dart';
import '../../shared/widgets/gradient_button.dart';

class AccountsScreen extends StatefulWidget {
  const AccountsScreen({super.key});

  @override
  State<AccountsScreen> createState() => _AccountsScreenState();
}

class _AccountsScreenState extends State<AccountsScreen> {
  bool _isLoading = true;
  List<AccountModel> _accounts = [];
  double _totalBalance = 0.0;

  @override
  void initState() {
    super.initState();
    _fetchAccounts();
  }

  Future<void> _fetchAccounts() async {
    setState(() => _isLoading = true);
    try {
      final res = await apiClient.get(ApiEndpoints.accounts);
      if (res.statusCode == 200 && res.data['success'] == true) {
        final data = res.data['data'];
        final list = (data['accounts'] as List)
            .map((json) => AccountModel.fromJson(json))
            .toList();

        setState(() {
          _accounts = list;
          _totalBalance = double.tryParse(data['totalBalance']?.toString() ?? '0') ?? 0.0;
          _isLoading = false;
        });
      }
    } catch (_) {
      setState(() => _isLoading = false);
    }
  }

  void _showAddAccountDialog() {
    final nameController = TextEditingController();
    final instController = TextEditingController(text: 'HDFC Bank');
    final maskedController = TextEditingController(text: '1234');
    final balanceController = TextEditingController(text: '10000');
    String type = 'BANK';

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => Padding(
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
              const Text('Add Financial Account', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
              const SizedBox(height: 16),
              TextField(
                controller: nameController,
                decoration: const InputDecoration(labelText: 'Account Nickname (e.g. Salary A/c)'),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: instController,
                decoration: const InputDecoration(labelText: 'Bank / Institution (e.g. SBI, ICICI, HDFC)'),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: maskedController,
                decoration: const InputDecoration(labelText: 'Last 4 Digits of Account Number'),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: balanceController,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Initial Balance (₹)'),
              ),
              const SizedBox(height: 24),
              GradientButton(
                text: 'Save Account',
                onPressed: () async {
                  if (nameController.text.trim().isEmpty) return;
                  Navigator.pop(ctx);
                  try {
                    await apiClient.post(
                      ApiEndpoints.accounts,
                      data: {
                        'name': nameController.text.trim(),
                        'institution': instController.text.trim(),
                        'accountNumberMasked': maskedController.text.trim(),
                        'accountType': type,
                        'balance': double.tryParse(balanceController.text) ?? 0,
                      },
                    );
                    _fetchAccounts();
                  } catch (_) {}
                },
              ),
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
        title: const Text('Accounts & Balances'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add_rounded),
            onPressed: _showAddAccountDialog,
          ),
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _fetchAccounts,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // Total balance summary card
                  FinancialCard(
                    padding: const EdgeInsets.all(22),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'TOTAL LIQUID ASSETS',
                          style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.8, color: AppColors.darkTextSecondary),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          CurrencyFormatter.format(_totalBalance),
                          style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w800),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          'Across ${_accounts.length} active Indian accounts',
                          style: const TextStyle(fontSize: 12.5, color: AppColors.darkTextSecondary),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 24),

                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Your Accounts', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                      TextButton.icon(
                        icon: const Icon(Icons.add_rounded, size: 16),
                        label: const Text('Add Account'),
                        onPressed: _showAddAccountDialog,
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),

                  if (_accounts.isEmpty)
                    EmptyStateView(
                      icon: Icons.account_balance_rounded,
                      title: 'No Accounts Connected',
                      description: 'Add your bank account or wallet to track balances.',
                      actionLabel: 'Add First Account',
                      onAction: _showAddAccountDialog,
                    )
                  else
                    ..._accounts.map((acc) => Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: FinancialCard(
                            padding: const EdgeInsets.all(18),
                            child: Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                    color: AppColors.primary.withValues(alpha: 0.12),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: const Icon(Icons.account_balance_rounded, color: AppColors.primaryLight, size: 22),
                                ),
                                const SizedBox(width: 16),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(acc.name, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                                      const SizedBox(height: 2),
                                      Text(
                                        '${acc.institution ?? "Bank"} • ${acc.accountNumberMasked != null ? "•••• ${acc.accountNumberMasked!}" : acc.accountType}',
                                        style: const TextStyle(fontSize: 12, color: AppColors.darkTextSecondary),
                                      ),
                                    ],
                                  ),
                                ),
                                Text(
                                  CurrencyFormatter.format(acc.balance),
                                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                                ),
                              ],
                            ),
                          ),
                        )),
                ],
              ),
            ),
    );
  }
}
