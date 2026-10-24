import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/api/api_error.dart';
import '../../core/models/account_model.dart';
import '../../core/utils/currency_formatter.dart';
import '../../shared/widgets/empty_state_view.dart';
import '../../shared/widgets/error_state_view.dart';
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
  String? _errorMessage;
  List<AccountModel> _accounts = [];
  double _totalBalance = 0.0;

  @override
  void initState() {
    super.initState();
    _fetchAccounts();
  }

  Future<void> _fetchAccounts() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });
    try {
      final res = await apiClient.get(ApiEndpoints.accounts);
      if (res.statusCode == 200 && res.data['success'] == true) {
        final data = res.data['data'];
        final rawAccounts = data is Map ? data['accounts'] : null;
        if (rawAccounts is! List) {
          throw const FormatException('Accounts response missing list');
        }

        final list = rawAccounts
            .whereType<Map>()
            .map((json) => AccountModel.fromJson(Map<String, dynamic>.from(json)))
            .toList();
        final totalBalance = double.tryParse(
              (data is Map ? data['totalBalance'] : null)?.toString() ?? '0',
            ) ??
            0.0;

        if (!mounted) return;
        setState(() {
          _accounts = list;
          _totalBalance = totalBalance;
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
            'Your accounts could not be loaded. Check your connection and try again.';
        _isLoading = false;
      });
    }
  }

  /// Cash-like categories have no bank account number, so the masked-number
  /// field is optional for them. Bank/card categories keep the existing
  /// required last-4 rule.
  bool _isCashLikeType(String type) =>
      type == 'CASH' ||
      type == 'CASH_WALLET' ||
      type == 'CASH_IN_HAND' ||
      type == 'OTHER';

  Future<void> _showAccountSheet({AccountModel? account}) async {
    final isEditing = account != null;
    final nameController = TextEditingController(text: account?.name ?? '');
    final instController = TextEditingController(text: account?.institution ?? '');
    final maskedController =
        TextEditingController(text: account?.accountNumberMasked ?? '');
    final balanceController = TextEditingController(
      text: account == null ? '' : account.balance.toStringAsFixed(2),
    );
    var selectedType = account?.accountType ?? 'BANK';

    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) {
          final isCashLike = _isCashLikeType(selectedType);
          return _DisposeControllers(
            controllers: [
              nameController,
              instController,
              maskedController,
              balanceController,
            ],
            child: SingleChildScrollView(
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
                  isEditing ? 'Edit Financial Account' : 'Add Financial Account',
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 16),
                TextField(
                  key: const ValueKey('account-name-field'),
                  controller: nameController,
                  textCapitalization: TextCapitalization.words,
                  decoration: const InputDecoration(
                    labelText: 'Account Nickname (e.g. Salary A/c)',
                  ),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  key: const ValueKey('account-type-dropdown'),
                  initialValue: selectedType,
                  isExpanded: true,
                  decoration: const InputDecoration(
                    labelText: 'Account Category',
                  ),
                  items: AccountModel.accountTypeValues
                      .map(
                        (type) => DropdownMenuItem<String>(
                          key: ValueKey('account-type-$type'),
                          value: type,
                          child: Text(AccountModel.labelForAccountType(type)),
                        ),
                      )
                      .toList(),
                  onChanged: (value) {
                    if (value == null || value == selectedType) return;
                    setModalState(() => selectedType = value);
                  },
                ),
                const SizedBox(height: 12),
                TextField(
                  key: const ValueKey('account-institution-field'),
                  controller: instController,
                  textCapitalization: TextCapitalization.words,
                  decoration: InputDecoration(
                    labelText: isCashLike
                        ? 'Notes / Provider (optional)'
                        : 'Bank / Institution (optional)',
                    hintText: isCashLike ? 'e.g. Paytm wallet' : 'e.g. HDFC Bank',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  key: const ValueKey('account-masked-field'),
                  controller: maskedController,
                  keyboardType: TextInputType.number,
                  inputFormatters: [
                    FilteringTextInputFormatter.digitsOnly,
                    LengthLimitingTextInputFormatter(4),
                  ],
                  decoration: InputDecoration(
                    labelText: isCashLike
                        ? 'Last 4 Digits (optional for cash accounts)'
                        : 'Last 4 Digits of Account Number',
                    hintText: 'e.g. 1234',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  key: const ValueKey('account-balance-field'),
                  controller: balanceController,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: InputDecoration(
                    labelText: isEditing
                        ? 'Current Balance (₹)'
                        : 'Opening Balance (₹)',
                    hintText: 'e.g. 10000',
                  ),
                ),
                const SizedBox(height: 24),
                GradientButton(
                  text: isEditing ? 'Save Changes' : 'Save Account',
                  onPressed: () async {
                    final name = nameController.text.trim();
                    final masked = maskedController.text.trim();
                    final balance =
                        double.tryParse(balanceController.text.trim());
                    final requiresMasked = !_isCashLikeType(selectedType);

                    String? validationError;
                    if (name.isEmpty) {
                      validationError = 'Enter an account nickname.';
                    } else if (masked.isNotEmpty &&
                        !RegExp(r'^\d{4}$').hasMatch(masked)) {
                      validationError =
                          'Enter the last 4 digits, or leave it empty for a cash account.';
                    } else if (requiresMasked && masked.isEmpty) {
                      validationError =
                          'Enter the last 4 digits of the account number.';
                    } else if (balance == null || balance < 0) {
                      validationError = 'Enter a valid balance.';
                    }
                    if (validationError != null) {
                      ScaffoldMessenger.of(ctx).showSnackBar(
                        SnackBar(content: Text(validationError)),
                      );
                      return;
                    }

                    final payload = <String, dynamic>{
                      'name': name,
                      'accountType': selectedType,
                      'institution': instController.text.trim(),
                      'balance': balance,
                    };
                    if (masked.isNotEmpty) {
                      payload['accountNumberMasked'] = masked;
                    } else if (isEditing) {
                      // Explicit empty clears a previously stored mask; the
                      // backend treats an omitted key as "leave unchanged".
                      payload['accountNumberMasked'] = '';
                    }

                    try {
                      final res = isEditing
                          ? await apiClient.patch(
                              ApiEndpoints.account(account.id),
                              data: payload,
                            )
                          : await apiClient.post(
                              ApiEndpoints.accounts,
                              data: payload,
                            );
                      final ok = (res.statusCode == 200 ||
                              res.statusCode == 201) &&
                          res.data['success'] == true;
                      if (!ok) {
                        throw const FormatException('Unexpected response');
                      }
                      if (!ctx.mounted) return;
                      Navigator.pop(ctx);
                      _fetchAccounts();
                    } catch (error) {
                      if (!ctx.mounted) return;
                      ScaffoldMessenger.of(ctx).showSnackBar(
                        SnackBar(
                          content: Text(
                            apiErrorMessage(error) ??
                                'Account could not be saved. Please try again.',
                          ),
                        ),
                      );
                    }
                  },
                ),
              ],
            ),
          ),
        );
        },
      ),
    );
  }

  /// Opens the deposit sheet. A deposit is only reported as successful after
  /// the server answers 2xx; on any failure the sheet keeps the entered amount
  /// visible and shows the server's own error message.
  Future<void> _showDepositSheet({AccountModel? account}) async {
    if (_accounts.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Add a financial account before making a deposit.'),
        ),
      );
      return;
    }

    final result = await showModalBottomSheet<_DepositResult>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => _DepositSheet(
        accounts: _accounts,
        initialAccountId: account?.id,
      ),
    );

    if (result == null || !mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          result.formattedNewBalance != null
              ? '${result.message} New balance: ${result.formattedNewBalance}'
              : result.message,
        ),
      ),
    );

    // The server moved the money; re-read so the displayed balance is the
    // persisted truth rather than a locally guessed increment.
    await _fetchAccounts();
  }

  /// Account removal is a server-side soft delete (`isActive: false`): the
  /// account disappears from active balances while past transactions keep
  /// their history, so the confirmation says exactly that.
  Future<void> _deleteAccount(AccountModel account) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remove account?'),
        content: Text(
          '“${account.name}” will be removed from your active accounts and '
          'balances. Past transactions stay in your history.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    try {
      await apiClient.delete(ApiEndpoints.account(account.id));
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Account removed.')),
      );
      _fetchAccounts();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            apiErrorMessage(error) ??
                'Account could not be removed. Check your connection.',
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
        title: const Text('Accounts & Balances'),
        actions: [
          IconButton(
            tooltip: 'Deposit funds',
            icon: const Icon(Icons.add_card_rounded),
            onPressed: _accounts.isEmpty
                ? null
                : () => _showDepositSheet(),
          ),
          IconButton(
            tooltip: 'Add account',
            icon: const Icon(Icons.add_rounded),
            onPressed: () => _showAccountSheet(),
          ),
          IconButton(
            tooltip: 'Refresh accounts',
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _fetchAccounts,
          ),
        ],
      ),
      body: _isLoading
          ? _buildSkeleton()
          : _errorMessage != null
          ? ErrorStateView(message: _errorMessage!, onRetry: _fetchAccounts)
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
                          onPressed: () => _showAccountSheet(),
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
                        onAction: () => _showAccountSheet(),
                      )
                    else
                      ..._accounts.map(
                        (acc) => Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: _AccountTile(
                            account: acc,
                            isDark: isDark,
                            onEdit: () => _showAccountSheet(account: acc),
                            onDelete: () => _deleteAccount(acc),
                            onDeposit: () => _showDepositSheet(account: acc),
                          ),
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

IconData _accountTypeIcon(String type) {
  switch (type) {
    case 'CASH':
    case 'CASH_IN_HAND':
      return Icons.payments_rounded;
    case 'CASH_WALLET':
    case 'WALLET':
      return Icons.account_balance_wallet_rounded;
    case 'CREDIT_CARD':
      return Icons.credit_card_rounded;
    case 'SAVINGS':
      return Icons.savings_rounded;
    case 'CURRENT':
      return Icons.business_center_rounded;
    case 'BANK':
      return Icons.account_balance_rounded;
    default:
      return Icons.account_balance_wallet_outlined;
  }
}

class _AccountTile extends StatelessWidget {
  final AccountModel account;
  final bool isDark;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final VoidCallback onDeposit;

  const _AccountTile({
    required this.account,
    required this.isDark,
    required this.onEdit,
    required this.onDelete,
    required this.onDeposit,
  });

  @override
  Widget build(BuildContext context) {
    final detailParts = <String>[account.accountTypeLabel];
    if (account.institution?.trim().isNotEmpty == true) {
      detailParts.add(account.institution!.trim());
    }
    if (account.accountNumberMasked != null &&
        account.accountNumberMasked!.isNotEmpty) {
      detailParts.add('•••• ${account.accountNumberMasked}');
    }
    final detail = detailParts.join(' • ');

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
            child: Icon(
              _accountTypeIcon(account.accountType),
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
          PopupMenuButton<String>(
            tooltip: 'Account options',
            padding: EdgeInsets.zero,
            onSelected: (value) {
              if (value == 'edit') onEdit();
              if (value == 'deposit') onDeposit();
              if (value == 'delete') onDelete();
            },
            itemBuilder: (_) => const [
              PopupMenuItem<String>(
                value: 'edit',
                child: Text('Edit account'),
              ),
              PopupMenuItem<String>(
                value: 'deposit',
                child: Text('Add money'),
              ),
              PopupMenuItem<String>(
                value: 'delete',
                child: Text('Remove account'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// The server's confirmation for a completed deposit.
class _DepositResult {
  final String message;
  final String? formattedNewBalance;

  const _DepositResult({required this.message, this.formattedNewBalance});
}

/// Deposit form for `POST /accounts/:accountId/deposit`.
///
/// The server accepts an optional `idempotencyKey`. This sheet generates one
/// key per sheet instance and reuses it for every retry of the same deposit,
/// so a request that timed out (and may already have been applied) can never
/// credit the account twice. A new deposit always opens a new sheet, and
/// therefore gets a new key.
class _DepositSheet extends StatefulWidget {
  final List<AccountModel> accounts;
  final String? initialAccountId;

  const _DepositSheet({required this.accounts, this.initialAccountId});

  @override
  State<_DepositSheet> createState() => _DepositSheetState();
}

class _DepositSheetState extends State<_DepositSheet> {
  final _formKey = GlobalKey<FormState>();
  final _amount = TextEditingController();

  late String _accountId;
  bool _isSubmitting = false;
  String? _error;

  /// Identifies this logical deposit. Stable across retries, new for a new
  /// deposit.
  late final String _idempotencyKey;

  @override
  void initState() {
    super.initState();
    final ids = widget.accounts.map((account) => account.id).toSet();
    final initial = widget.initialAccountId;
    _accountId = (initial != null && ids.contains(initial))
        ? initial
        : widget.accounts.first.id;
    _idempotencyKey = _newIdempotencyKey();
  }

  static String _newIdempotencyKey() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
    return 'dep-$hex';
  }

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_isSubmitting) return;
    if (!(_formKey.currentState?.validate() ?? false)) return;

    final amount = double.parse(_amount.text.trim());

    setState(() {
      _isSubmitting = true;
      _error = null;
    });

    try {
      final res = await apiClient.post(
        ApiEndpoints.accountDeposit(_accountId),
        data: {
          'amount': amount,
          // Same key for every retry of this deposit: a retried request
          // resolves to the original transaction instead of crediting twice.
          'idempotencyKey': _idempotencyKey,
        },
      );

      if (res.statusCode == 200 &&
          res.data['success'] == true &&
          res.data['data'] is Map) {
        final data = Map<String, dynamic>.from(res.data['data'] as Map);
        if (!mounted) return;
        Navigator.pop(
          context,
          _DepositResult(
            message: serverMessage(res.data) ?? 'Deposit successful.',
            formattedNewBalance: data['formattedNewBalance'] is String
                ? data['formattedNewBalance'] as String
                : null,
          ),
        );
        return;
      }

      if (!mounted) return;
      setState(() {
        _error = 'The server returned an unexpected response.';
        _isSubmitting = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error =
            apiErrorMessage(error) ??
            'The deposit could not be completed. Check your connection and try again.';
        _isSubmitting = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Padding(
      padding: EdgeInsets.only(
        left: 24,
        right: 24,
        top: 24,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Add money',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 6),
            Text(
              'Adds the amount to the account balance and records an income '
              'entry in your transactions.',
              style: TextStyle(
                fontSize: 12,
                height: 1.4,
                color: AppColors.textSecondary(isDark),
              ),
            ),
            const SizedBox(height: 18),

            if (widget.accounts.length > 1)
              DropdownButtonFormField<String>(
                initialValue: _accountId,
                decoration: const InputDecoration(labelText: 'Deposit into'),
                items: [
                  for (final account in widget.accounts)
                    DropdownMenuItem<String>(
                      value: account.id,
                      child: Text(
                        '${account.name} • ${CurrencyFormatter.format(account.balance)}',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                ],
                onChanged: _isSubmitting
                    ? null
                    : (value) {
                        if (value != null) {
                          setState(() => _accountId = value);
                        }
                      },
              )
            else
              InputDecorator(
                decoration: const InputDecoration(labelText: 'Deposit into'),
                child: Text(
                  '${widget.accounts.first.name} • '
                  '${CurrencyFormatter.format(widget.accounts.first.balance)}',
                  overflow: TextOverflow.ellipsis,
                ),
              ),

            const SizedBox(height: 14),
            TextFormField(
              controller: _amount,
              enabled: !_isSubmitting,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
              ],
              autovalidateMode: AutovalidateMode.onUserInteraction,
              validator: (value) {
                final text = (value ?? '').trim();
                if (text.isEmpty) return 'Enter an amount.';
                if (!RegExp(r'^\d+(\.\d{1,2})?$').hasMatch(text)) {
                  return 'Enter a valid amount (up to 2 decimals).';
                }
                final parsed = double.tryParse(text);
                if (parsed == null || parsed <= 0) {
                  return 'Enter an amount greater than ₹0.';
                }
                return null;
              },
              decoration: const InputDecoration(
                labelText: 'Amount',
                hintText: 'e.g. 5000',
                prefixText: '₹ ',
              ),
            ),

            if (_error != null) ...[
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.expense.withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: AppColors.expense.withValues(alpha: 0.35),
                  ),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(
                      Icons.error_outline_rounded,
                      size: 18,
                      color: AppColors.expense,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        _error!,
                        style: const TextStyle(
                          fontSize: 12.5,
                          height: 1.4,
                          color: AppColors.expense,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],

            const SizedBox(height: 20),
            GradientButton(
              text: _isSubmitting ? 'Adding…' : 'Add money',
              icon: Icons.add_card_rounded,
              isLoading: _isSubmitting,
              onPressed: _isSubmitting ? null : _submit,
            ),
          ],
        ),
      ),
    );
  }
}

/// Owns the account-form controllers for the lifetime of the bottom sheet.
///
/// `showModalBottomSheet` completes as soon as the pop starts, while the sheet
/// is still animating out and its [TextField]s still reference the controllers.
/// Disposing them at that point throws "used after being disposed" in debug, so
/// disposal is tied to the sheet widget being unmounted instead.
class _DisposeControllers extends StatefulWidget {
  final List<TextEditingController> controllers;
  final Widget child;

  const _DisposeControllers({
    required this.controllers,
    required this.child,
  });

  @override
  State<_DisposeControllers> createState() => _DisposeControllersState();
}

class _DisposeControllersState extends State<_DisposeControllers> {
  @override
  void dispose() {
    for (final controller in widget.controllers) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
