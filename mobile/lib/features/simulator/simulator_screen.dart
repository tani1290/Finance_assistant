import 'dart:math';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/api/api_error.dart';
import '../../core/utils/currency_formatter.dart';
import '../../shared/widgets/empty_state_view.dart';
import '../../shared/widgets/error_state_view.dart';
import '../../shared/widgets/financial_card.dart';
import '../../shared/widgets/gradient_button.dart';
import '../../shared/widgets/status_badge.dart';

/// Synthetic payment simulator.
///
/// Drives the demo-only `/simulator` API. It never contacts a bank, card
/// network or UPI provider, never accepts real payment credentials and never
/// moves real money. Every value shown comes from rows the backend explicitly
/// marks as synthetic; nothing is fabricated when a request fails.
class SimulatorScreen extends StatefulWidget {
  const SimulatorScreen({super.key});

  @override
  State<SimulatorScreen> createState() => _SimulatorScreenState();
}

class _SimulatorScreenState extends State<SimulatorScreen> {
  static const List<String> _methods = [
    'CARD',
    'UPI',
    'NET_BANKING',
    'WALLET',
    'BANK_TRANSFER',
  ];
  static const List<String> _scenarios = ['SUCCESS', 'PENDING', 'FAILURE'];
  static const List<String?> _filters = [
    null,
    'PENDING',
    'SUCCESS',
    'FAILED',
    'REFUNDED',
    'REVERSED',
  ];

  final _merchantController = TextEditingController();
  final _amountController = TextEditingController();
  final _categoryController = TextEditingController();
  final _descriptionController = TextEditingController();

  bool _isLoading = true;
  String? _errorMessage;
  Map<String, dynamic>? _status;
  List<Map<String, dynamic>> _payments = [];

  String? _filter;
  String _method = 'CARD';
  String _scenario = 'SUCCESS';

  bool _isCreating = false;
  bool _isBusy = false;
  String? _busyPaymentId;

  /// One key per logical payment. It is rotated only after the backend accepts
  /// a create, so retrying a failed request replays instead of duplicating.
  late String _idempotencyKey;

  bool get _enabled => _status?['enabled'] == true;
  num? get _maxAmount => _status?['maxAmount'] as num?;
  num? get _seedAmount => _status?['seedAmount'] as num?;

  @override
  void initState() {
    super.initState();
    _idempotencyKey = _newIdempotencyKey();
    _refresh(showSpinner: true);
  }

  @override
  void dispose() {
    _merchantController.dispose();
    _amountController.dispose();
    _categoryController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  static String _newIdempotencyKey() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
    return 'sim-$hex';
  }

  Map<String, dynamic>? _asMap(dynamic value) {
    if (value is Map<String, dynamic>) return value;
    if (value is Map) return Map<String, dynamic>.from(value);
    return null;
  }

  int _count(String status) {
    final counts = _asMap(_status?['counts']);
    final value = counts?[status];
    return value is num ? value.toInt() : 0;
  }

  String _label(String value) {
    final words = value.replaceAll('_', ' ').toLowerCase().split(' ');
    return words
        .where((word) => word.isNotEmpty)
        .map((word) => word[0].toUpperCase() + word.substring(1))
        .join(' ');
  }

  Future<void> _refresh({bool showSpinner = false}) async {
    if (showSpinner && mounted) {
      setState(() {
        _isLoading = true;
        _errorMessage = null;
      });
    }

    try {
      final statusResponse = await apiClient.get(ApiEndpoints.simulatorStatus);
      final status = _asMap(statusResponse.data['data']);
      if (status == null) {
        if (!mounted) return;
        setState(() {
          _isLoading = false;
          _errorMessage = 'The simulator returned an unexpected response.';
        });
        return;
      }

      List<Map<String, dynamic>> payments = [];
      if (status['enabled'] == true) {
        final paymentsResponse = await apiClient.get(
          ApiEndpoints.simulatorPayments,
          queryParameters: {
            if (_filter != null) 'status': _filter,
            'limit': 50,
          },
        );
        final data = _asMap(paymentsResponse.data['data']);
        final raw = data?['payments'];
        if (raw is List) {
          payments = raw
              .map(_asMap)
              .whereType<Map<String, dynamic>>()
              .toList(growable: false);
        }
      }

      if (!mounted) return;
      setState(() {
        _status = status;
        _payments = payments;
        _isLoading = false;
        _errorMessage = null;
      });
    } catch (error) {
      if (!mounted) return;
      final message = apiErrorMessage(error) ??
          'Could not reach the simulator. Check your connection.';
      if (_status == null) {
        setState(() {
          _isLoading = false;
          _errorMessage = message;
        });
      } else {
        setState(() => _isLoading = false);
        _showSnack(message);
      }
    }
  }

  void _showSnack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  Future<bool> _confirm({
    required String title,
    required String message,
    required String confirmLabel,
    bool destructive = false,
  }) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(
              confirmLabel,
              style: destructive
                  ? const TextStyle(color: AppColors.expense)
                  : null,
            ),
          ),
        ],
      ),
    );
    return confirmed == true && mounted;
  }

  Future<void> _seed() async {
    if (!_enabled || _isBusy) return;
    setState(() => _isBusy = true);
    try {
      final response = await apiClient.post(ApiEndpoints.simulatorSeed);
      final message = _asMap(response.data['data'])?['message'] as String?;
      _showSnack(message ?? 'Demo funds added to the synthetic account.');
      await _refresh();
    } catch (error) {
      _showSnack(
        apiErrorMessage(error) ?? 'Demo funds could not be added.',
      );
      await _refresh();
    } finally {
      if (mounted) setState(() => _isBusy = false);
    }
  }

  Future<void> _reset() async {
    if (!_enabled || _isBusy) return;
    final confirmed = await _confirm(
      title: 'Reset simulator?',
      message:
          'This removes every simulated payment and its refund/reversal rows '
          'and undoes their synthetic ledger effects. Demo seed funding is '
          'kept. No real money is involved.',
      confirmLabel: 'Reset',
      destructive: true,
    );
    if (!confirmed) return;

    setState(() => _isBusy = true);
    try {
      final response = await apiClient.post(ApiEndpoints.simulatorReset);
      final message = _asMap(response.data['data'])?['message'] as String?;
      _showSnack(message ?? 'Simulator reset. Demo seed funding was kept.');
      await _refresh();
    } catch (error) {
      _showSnack(
        apiErrorMessage(error) ?? 'The simulator could not be reset.',
      );
      await _refresh();
    } finally {
      if (mounted) setState(() => _isBusy = false);
    }
  }

  Future<void> _createPayment() async {
    if (!_enabled || _isCreating) return;

    final merchant = _merchantController.text.trim();
    final amount = double.tryParse(_amountController.text.trim());
    final maxAmount = _maxAmount?.toDouble();

    if (merchant.isEmpty) {
      _showSnack('Enter a merchant name.');
      return;
    }
    if (amount == null || amount <= 0) {
      _showSnack('Enter an amount greater than zero.');
      return;
    }
    if (maxAmount != null && amount > maxAmount) {
      _showSnack(
        'The simulator cap is ${CurrencyFormatter.format(maxAmount, includeDecimals: true)}.',
      );
      return;
    }

    final category = _categoryController.text.trim();
    final description = _descriptionController.text.trim();

    setState(() => _isCreating = true);
    try {
      final response = await apiClient.post(
        ApiEndpoints.simulatorPayments,
        data: {
          'idempotencyKey': _idempotencyKey,
          'amount': amount,
          'merchant': merchant,
          'paymentMethod': _method,
          'scenario': _scenario,
          if (category.isNotEmpty) 'categoryName': category,
          if (description.isNotEmpty) 'description': description,
        },
      );

      // Accepted create: the logical payment is complete, so the next one gets
      // a fresh key. A failed request deliberately keeps the old key.
      _idempotencyKey = _newIdempotencyKey();
      _merchantController.clear();
      _amountController.clear();
      _categoryController.clear();
      _descriptionController.clear();

      final message = _asMap(response.data['data'])?['message'] as String?;
      _showSnack(message ?? 'Simulated payment created.');
      await _refresh();
    } catch (error) {
      _showSnack(
        apiErrorMessage(error) ?? 'The simulated payment could not be created.',
      );
    } finally {
      if (mounted) setState(() => _isCreating = false);
    }
  }

  Future<void> _runPaymentAction(
    String paymentId,
    _PaymentAction action,
  ) async {
    if (!_enabled || _busyPaymentId != null || _isBusy) return;

    if (action.confirmMessage != null) {
      final confirmed = await _confirm(
        title: action.confirmTitle!,
        message: action.confirmMessage!,
        confirmLabel: action.label,
        destructive: action == _PaymentAction.reverse,
      );
      if (!confirmed) return;
    }

    setState(() => _busyPaymentId = paymentId);
    try {
      final response = await apiClient.post(action.path(paymentId));
      final message = _asMap(response.data['data'])?['message'] as String?;
      _showSnack(message ?? 'Simulated payment updated.');
      await _refresh();
    } catch (error) {
      _showSnack(
        apiErrorMessage(error) ?? 'The simulated payment could not be updated.',
      );
      await _refresh();
    } finally {
      if (mounted) setState(() => _busyPaymentId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Payment Simulator'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Refresh',
            onPressed: _isLoading ? null : () => _refresh(),
          ),
        ],
      ),
      body: _isLoading && _status == null
          ? const Center(child: CircularProgressIndicator())
          : _status == null
              ? ErrorStateView(
                  message: _errorMessage ??
                      'The simulator could not be loaded. Try again.',
                  onRetry: () => _refresh(showSpinner: true),
                )
              : RefreshIndicator(
                  onRefresh: _refresh,
                  child: ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
                    children: [
                      _disclaimerCard(isDark),
                      const SizedBox(height: 16),
                      if (!_enabled)
                        _disabledCard(isDark)
                      else ...[
                        _activityCard(isDark),
                        const SizedBox(height: 16),
                        _fundingCard(isDark),
                        const SizedBox(height: 16),
                        _createCard(isDark),
                        const SizedBox(height: 24),
                        _paymentsSection(isDark),
                      ],
                    ],
                  ),
                ),
    );
  }

  Widget _disclaimerCard(bool isDark) {
    final disclaimer = _status?['disclaimer'] as String? ??
        'Synthetic demo only — no bank, card network or UPI provider is '
            'contacted and no real money moves.';
    return FinancialCard(
      accent: AppColors.warning,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(9),
            decoration: BoxDecoration(
              color: AppColors.warning.withValues(alpha: 0.14),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Icon(
              Icons.science_outlined,
              size: 20,
              color: AppColors.warning,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Demo only — no real money',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary(isDark),
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  disclaimer,
                  style: TextStyle(
                    fontSize: 12,
                    height: 1.45,
                    color: AppColors.textSecondary(isDark),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _disabledCard(bool isDark) {
    final reason = _status?['disabledReason'] as String?;
    return FinancialCard(
      accent: AppColors.expense,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.power_settings_new_rounded,
                size: 20,
                color: AppColors.expense,
              ),
              const SizedBox(width: 8),
              Text(
                'Simulator disabled',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary(isDark),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            reason ??
                'This environment has not opted into the synthetic payment '
                    'simulator. Mutations stay blocked until the server enables '
                    'them explicitly.',
            style: TextStyle(
              fontSize: 12.5,
              height: 1.5,
              color: AppColors.textSecondary(isDark),
            ),
          ),
          const SizedBox(height: 10),
          Text(
            'In production both PAYMENT_SIMULATOR_ENABLED and '
            'PAYMENT_SIMULATOR_ALLOW_PRODUCTION must be set to true.',
            style: TextStyle(
              fontSize: 11.5,
              height: 1.45,
              color: AppColors.textMuted(isDark),
            ),
          ),
        ],
      ),
    );
  }

  Widget _activityCard(bool isDark) {
    final production = _status?['production'] == true;
    return FinancialCard(
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                'Simulator activity',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary(isDark),
                ),
              ),
              const Spacer(),
              StatusBadge(
                label: production ? 'Production' : 'Non-production',
                color: production ? AppColors.warning : AppColors.info,
                icon: production
                    ? Icons.warning_amber_rounded
                    : Icons.computer_rounded,
              ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _metric(
                  isDark,
                  'Demo funding',
                  _seedAmount != null
                      ? CurrencyFormatter.format(_seedAmount)
                      : '—',
                ),
              ),
              Expanded(
                child: _metric(
                  isDark,
                  'Pending',
                  '${_count('PENDING')}',
                  color: AppColors.warning,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _metric(
                  isDark,
                  'Settled',
                  '${_count('SUCCESS')}',
                  color: AppColors.income,
                ),
              ),
              Expanded(
                child: _metric(
                  isDark,
                  'Refunded / reversed',
                  '${_count('REFUNDED') + _count('REVERSED')}',
                  color: AppColors.info,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            'Per-payment cap '
            '${_status?['formattedMaxAmount'] ?? '—'} · statuses and balances '
            'are set only by the server.',
            style: TextStyle(
              fontSize: 11.5,
              height: 1.4,
              color: AppColors.textMuted(isDark),
            ),
          ),
        ],
      ),
    );
  }

  Widget _metric(bool isDark, String label, String value, {Color? color}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 11.5,
            color: AppColors.textMuted(isDark),
          ),
        ),
        const SizedBox(height: 3),
        Text(
          value,
          style: TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w700,
            color: color ?? AppColors.textPrimary(isDark),
          ),
        ),
      ],
    );
  }

  Widget _fundingCard(bool isDark) {
    final claimed = _status?['seedClaimed'] == true;
    return FinancialCard(
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Demo funds',
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary(isDark),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Adds ${_status?['formattedSeedAmount'] ?? 'a fixed amount'} of '
            'clearly labelled synthetic funding once. It is server-controlled '
            'and cannot be set by the client.',
            style: TextStyle(
              fontSize: 12,
              height: 1.45,
              color: AppColors.textSecondary(isDark),
            ),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              OutlinedButton.icon(
                onPressed: claimed || _isBusy ? null : _seed,
                icon: _isBusy
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.savings_outlined, size: 18),
                label: Text(claimed ? 'Demo funds already added' : 'Add demo funds'),
              ),
              OutlinedButton.icon(
                onPressed: _isBusy ? null : _reset,
                icon: const Icon(Icons.restart_alt_rounded, size: 18),
                label: const Text('Reset simulator'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.expense,
                  side: BorderSide(
                    color: AppColors.expense.withValues(alpha: 0.35),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _createCard(bool isDark) {
    return FinancialCard(
      accent: AppColors.primary,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'New simulated payment',
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary(isDark),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Nothing here contacts a bank or UPI network. The server decides '
            'the date, the final status and every balance effect.',
            style: TextStyle(
              fontSize: 12,
              height: 1.45,
              color: AppColors.textSecondary(isDark),
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _amountController,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(
              labelText: 'Amount (₹)',
              hintText: 'e.g. 499.50',
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _merchantController,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(
              labelText: 'Merchant',
              hintText: 'e.g. Demo Coffee Co.',
            ),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _method,
            decoration: const InputDecoration(labelText: 'Payment method'),
            items: [
              for (final method in _methods)
                DropdownMenuItem(
                  value: method,
                  child: Text(_label(method)),
                ),
            ],
            onChanged: (value) {
              if (value != null) setState(() => _method = value);
            },
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _scenario,
            decoration: const InputDecoration(
              labelText: 'Scenario',
              helperText:
                  'Success settles, pending waits for you, failure never debits.',
            ),
            items: [
              for (final scenario in _scenarios)
                DropdownMenuItem(
                  value: scenario,
                  child: Text(_label(scenario)),
                ),
            ],
            onChanged: (value) {
              if (value != null) setState(() => _scenario = value);
            },
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _categoryController,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(
              labelText: 'Category (optional)',
              hintText: 'Resolved or created by the server',
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _descriptionController,
            decoration: const InputDecoration(
              labelText: 'Description (optional)',
            ),
          ),
          const SizedBox(height: 18),
          GradientButton(
            text: _isCreating ? 'Creating…' : 'Create simulated payment',
            icon: Icons.add_card_rounded,
            isLoading: _isCreating,
            onPressed: _isCreating ? null : _createPayment,
          ),
        ],
      ),
    );
  }

  Widget _paymentsSection(bool isDark) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(
              'Payments',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary(isDark),
              ),
            ),
            const Spacer(),
            Text(
              '${_payments.length} shown',
              style: TextStyle(
                fontSize: 11.5,
                color: AppColors.textMuted(isDark),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              for (final filter in _filters) ...[
                ChoiceChip(
                  label: Text(filter == null ? 'All' : _label(filter)),
                  selected: _filter == filter,
                  showCheckmark: false,
                  onSelected: (_) {
                    if (_filter == filter) return;
                    setState(() => _filter = filter);
                    _refresh();
                  },
                ),
                const SizedBox(width: 8),
              ],
            ],
          ),
        ),
        const SizedBox(height: 14),
        if (_payments.isEmpty)
          EmptyStateView(
            icon: Icons.receipt_long_outlined,
            title: _filter == null
                ? 'No simulated payments yet'
                : 'No ${_label(_filter!).toLowerCase()} payments',
            description: _filter == null
                ? 'Create a payment above to watch the synthetic lifecycle, '
                    'refund and reversal behaviour. No real money moves.'
                : 'Try a different status filter or create a new simulated '
                    'payment.',
          )
        else
          for (final payment in _payments) ...[
            _paymentCard(isDark, payment),
            const SizedBox(height: 12),
          ],
      ],
    );
  }

  Widget _paymentCard(bool isDark, Map<String, dynamic> payment) {
    final id = payment['id'] as String? ?? '';
    final status = payment['status'] as String? ?? 'PENDING';
    final merchant = payment['merchant'] as String? ?? 'Simulated merchant';
    final description = payment['description'] as String?;
    final method = payment['paymentMethod'] as String?;
    final scenario = payment['scenario'] as String?;
    final failure = payment['failureMessage'] as String?;
    final amount = payment['amount'] as num?;
    final formatted = payment['formattedAmount'] as String? ??
        CurrencyFormatter.format(amount, includeDecimals: true);
    final createdAt = payment['createdAt'] is String
        ? DateTime.tryParse(payment['createdAt'] as String)?.toLocal()
        : null;
    final isBusy = _busyPaymentId == id;
    final actions = _actionsFor(status);

    return FinancialCard(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      merchant,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 14.5,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary(isDark),
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      [
                        if (method != null) _label(method),
                        if (scenario != null) '${_label(scenario)} scenario',
                        if (createdAt != null)
                          DateFormat('d MMM yyyy, h:mm a').format(createdAt),
                      ].join(' · '),
                      style: TextStyle(
                        fontSize: 11,
                        color: AppColors.textMuted(isDark),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              StatusBadge(
                label: _label(status),
                color: _statusColor(status),
                icon: _statusIcon(status),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                formatted,
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary(isDark),
                ),
              ),
              const Spacer(),
              Text(
                'synthetic',
                style: TextStyle(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.4,
                  color: AppColors.textMuted(isDark),
                ),
              ),
            ],
          ),
          if (description != null && description.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              description,
              style: TextStyle(
                fontSize: 12,
                height: 1.4,
                color: AppColors.textSecondary(isDark),
              ),
            ),
          ],
          if (failure != null && failure.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              failure,
              style: const TextStyle(
                fontSize: 11.5,
                height: 1.4,
                color: AppColors.expense,
              ),
            ),
          ],
          if (actions.isNotEmpty) ...[
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final action in actions)
                  OutlinedButton(
                    onPressed: isBusy || _isBusy
                        ? null
                        : () => _runPaymentAction(id, action),
                    style: OutlinedButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                      foregroundColor: action == _PaymentAction.reverse ||
                              action == _PaymentAction.fail
                          ? AppColors.expense
                          : AppColors.primaryLight,
                      side: BorderSide(
                        color: (action == _PaymentAction.reverse ||
                                    action == _PaymentAction.fail
                                ? AppColors.expense
                                : AppColors.primary)
                            .withValues(alpha: 0.35),
                      ),
                    ),
                    child: isBusy
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(action.label),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  List<_PaymentAction> _actionsFor(String status) {
    switch (status) {
      case 'PENDING':
        return const [_PaymentAction.confirm, _PaymentAction.fail];
      case 'SUCCESS':
        return const [_PaymentAction.refund, _PaymentAction.reverse];
      default:
        return const [];
    }
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'SUCCESS':
        return AppColors.income;
      case 'FAILED':
        return AppColors.expense;
      case 'PENDING':
        return AppColors.warning;
      case 'REFUNDED':
        return AppColors.info;
      case 'REVERSED':
        return AppColors.purple;
      default:
        return AppColors.info;
    }
  }

  IconData _statusIcon(String status) {
    switch (status) {
      case 'SUCCESS':
        return Icons.check_circle_rounded;
      case 'FAILED':
        return Icons.cancel_rounded;
      case 'PENDING':
        return Icons.hourglass_top_rounded;
      case 'REFUNDED':
        return Icons.replay_rounded;
      case 'REVERSED':
        return Icons.undo_rounded;
      default:
        return Icons.info_outline_rounded;
    }
  }
}

/// The explicit lifecycle actions available for a settled/pending payment.
enum _PaymentAction {
  confirm(
    label: 'Confirm',
    path: ApiEndpoints.simulatorPaymentConfirm,
  ),
  fail(
    label: 'Fail',
    path: ApiEndpoints.simulatorPaymentFail,
  ),
  refund(
    label: 'Refund',
    path: ApiEndpoints.simulatorPaymentRefund,
    confirmTitle: 'Refund this payment?',
    confirmMessage:
        'A synthetic REFUND ledger row credits the demo account in full and '
        'reduces net spending. No real money moves.',
  ),
  reverse(
    label: 'Reverse',
    path: ApiEndpoints.simulatorPaymentReverse,
    confirmTitle: 'Reverse this payment?',
    confirmMessage:
        'A synthetic REVERSAL ledger row credits the demo account in full and '
        'reduces net spending. No real money moves.',
  );

  const _PaymentAction({
    required this.label,
    required this.path,
    this.confirmTitle,
    this.confirmMessage,
  });

  final String label;
  final String Function(String id) path;
  final String? confirmTitle;
  final String? confirmMessage;
}
