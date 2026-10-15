import 'package:flutter/material.dart';
import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/models/account_model.dart';
import '../../core/utils/currency_formatter.dart';
import '../../shared/widgets/empty_state_view.dart';
import '../../shared/widgets/financial_card.dart';
import '../../shared/widgets/gradient_button.dart';
import '../../shared/widgets/skeleton_loader.dart';
import '../../shared/widgets/summary_hero_card.dart';

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
          _totalBalance =
              double.tryParse(data['totalBalance']?.toString() ?? '0') ?? 0.0;
          _isLoading = false;
        });
      } else {
        setState(() => _isLoading = false);
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
    const type = 'BANK';

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
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
              const Text(
                'Add Financial Account',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: nameController,
                decoration: const InputDecoration(
                  labelText: 'Account Nickname (e.g. Salary A/c)',
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: instController,
                decoration: const InputDecoration(
                  labelText: 'Bank / Institution (e.g. SBI, ICICI, HDFC)',
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: maskedController,
                decoration: const InputDecoration(
                  labelText: 'Last 4 Digits of Account Number',
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: balanceController,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'Initial Balance (₹)',
                ),
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
    final isDark = Theme.of(context).brightness == Brightness.dark;

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
          ? _buildSkeleton()
          : RefreshIndicator(
              onRefresh: _fetchAccounts,
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    SummaryHeroCard(
                      label: 'Total Liquid Assets',
                      value: CurrencyFormatter.format(_totalBalance),
                      subtitle:
                          'Across ${_accounts.length} active ${_accounts.length == 1 ? "account" : "accounts"}',
                      icon: Icons.account_balance_wallet_rounded,
                    ),
                    const SizedBox(height: 24),

                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          'Your Accounts',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: AppColors.textPrimary(isDark),
                          ),
                        ),
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
                        description:
                            'Add your bank account or wallet to track balances.',
                        actionLabel: 'Add First Account',
                        onAction: _showAddAccountDialog,
                      )
                    else
                      ..._accounts.map(
                        (acc) => Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: _AccountTile(account: acc, isDark: isDark),
                        ),
                      ),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildSkeleton() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
      children: [
        const SkeletonLoader(width: double.infinity, height: 158, borderRadius: 18),
        const SizedBox(height: 24),
        const SkeletonLoader(width: 140, height: 18),
        const SizedBox(height: 14),
        for (var i = 0; i < 3; i++) ...[
          FinancialCard(
            padding: const EdgeInsets.all(18),
            child: Row(
              children: const [
                SkeletonLoader(width: 42, height: 42, borderRadius: 12),
                SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SkeletonLoader(width: 130, height: 14),
                      SizedBox(height: 8),
                      SkeletonLoader(width: 90, height: 11),
                    ],
                  ),
                ),
                SkeletonLoader(width: 72, height: 15),
              ],
            ),
          ),
          const SizedBox(height: 12),
        ],
      ],
    );
  }
}

class _AccountTile extends StatelessWidget {
  final AccountModel account;
  final bool isDark;

  const _AccountTile({required this.account, required this.isDark});

  @override
  Widget build(BuildContext context) {
    final detail = account.accountNumberMasked != null &&
            account.accountNumberMasked!.isNotEmpty
        ? '${account.institution ?? "Bank"} • •••• ${account.accountNumberMasked}'
        : '${account.institution ?? "Bank"} • ${account.accountType}';

    return FinancialCard(
      padding: const EdgeInsets.all(18),
      accent: AppColors.primary,
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(11),
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(
              Icons.account_balance_rounded,
              color: AppColors.primaryLight,
              size: 22,
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  account.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary(isDark),
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  detail,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12,
                    color: AppColors.textSecondary(isDark),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(
            CurrencyFormatter.format(account.balance),
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary(isDark),
            ),
          ),
        ],
      ),
    );
  }
}
