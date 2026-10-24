import 'dart:math';

import 'package:flutter/material.dart';
import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/api/api_error.dart';
import '../../core/models/account_model.dart';
import '../../shared/widgets/gradient_button.dart';

/// Bottom sheet that records a transaction through `POST /transactions`.
///
/// Mirrors the web "Add Transaction" modal: amount, type, category (free text —
/// the backend resolves or creates the category), optional account, merchant,
/// description, date and payment method. On success the caller refreshes its
/// list; a failure keeps the sheet open and reports the server's message.
class AddTransactionSheet extends StatefulWidget {
  const AddTransactionSheet({super.key, required this.onCreated});

  /// Invoked with the server's confirmation message after a successful create.
  final ValueChanged<String> onCreated;

  static Future<void> show(
    BuildContext context, {
    required ValueChanged<String> onCreated,
  }) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => AddTransactionSheet(onCreated: onCreated),
    );
  }

  @override
  State<AddTransactionSheet> createState() => _AddTransactionSheetState();
}

class _AddTransactionSheetState extends State<AddTransactionSheet> {
  static const _transactionTypes = ['EXPENSE', 'INCOME', 'TRANSFER'];

  final _amountController = TextEditingController();
  final _categoryController = TextEditingController();
  final _merchantController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _paymentMethodController = TextEditingController();

  String _type = 'EXPENSE';
  DateTime _date = DateTime.now();
  List<AccountModel> _accounts = const [];
  String? _accountId;
  String? _toAccountId;
  bool _isSaving = false;

  /// Identifies the transfer made from this sheet. It survives failed attempts
  /// so pressing save again retries the same transfer instead of moving money
  /// twice. A new sheet (a new transfer) gets a new key.
  late final String _transferIdempotencyKey;

  bool get _isTransfer => _type == 'TRANSFER';

  @override
  void initState() {
    super.initState();
    _transferIdempotencyKey = _newTransferIdempotencyKey();
    _loadAccounts();
  }

  static String _newTransferIdempotencyKey() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
    return 'tx-$hex';
  }

  @override
  void dispose() {
    _amountController.dispose();
    _categoryController.dispose();
    _merchantController.dispose();
    _descriptionController.dispose();
    _paymentMethodController.dispose();
    super.dispose();
  }

  /// Account selection is optional: when loading fails or there are no
  /// accounts the backend assigns the user's default account.
  Future<void> _loadAccounts() async {
    try {
      final res = await apiClient.get(ApiEndpoints.accounts);
      if (!mounted || res.statusCode != 200 || res.data['success'] != true) {
        return;
      }
      final data = res.data['data'];
      final raw = data is Map ? data['accounts'] : null;
      if (raw is! List) return;
      setState(() {
        _accounts = raw
            .whereType<Map>()
            .map(
              (json) => AccountModel.fromJson(Map<String, dynamic>.from(json)),
            )
            .toList();
      });
    } catch (_) {
      // Non-fatal: the form still works without an explicit account.
    }
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (picked != null && mounted) setState(() => _date = picked);
  }

  Future<void> _submit() async {
    if (_isSaving) return;

    final amount = double.tryParse(_amountController.text.trim());

    if (amount == null || amount <= 0) {
      _showError('Enter a valid amount greater than zero.');
      return;
    }

    if (_isTransfer) {
      if (_accounts.length < 2) {
        _showError('Add a second account before recording a transfer.');
        return;
      }
      if (_accountId == null) {
        _showError('Select the account the money is coming from.');
        return;
      }
      if (_toAccountId == null) {
        _showError('Select the destination account.');
        return;
      }
      if (_accountId == _toAccountId) {
        _showError('Source and destination accounts must differ.');
        return;
      }
    }

    setState(() => _isSaving = true);
    try {
      final res = await apiClient.post(
        ApiEndpoints.transactions,
        data: {
          'amount': amount,
          'type': _type,
          if (_categoryController.text.trim().isNotEmpty)
            'category': _categoryController.text.trim(),
          if (_accountId != null) 'accountId': _accountId,
          if (_isTransfer && _toAccountId != null) 'toAccountId': _toAccountId,
          // The backend rejects a key on non-transfers. For a transfer this
          // key is stable across retries from this sheet, so a timeout or
          // double tap resolves to the original transfer.
          if (_isTransfer) 'idempotencyKey': _transferIdempotencyKey,
          if (_merchantController.text.trim().isNotEmpty)
            'merchant': _merchantController.text.trim(),
          if (_descriptionController.text.trim().isNotEmpty)
            'description': _descriptionController.text.trim(),
          if (_paymentMethodController.text.trim().isNotEmpty)
            'paymentMethod': _paymentMethodController.text.trim(),
          'date': _date.toUtc().toIso8601String(),
        },
      );

      if (!mounted) return;
      final message = serverMessage(res.data) ?? 'Transaction created.';
      Navigator.pop(context);
      widget.onCreated(message);
    } catch (error) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      // Dio throws on non-2xx, so the backend's validation message (for
      // example an unknown account) is read from the thrown response.
      _showError(
        apiErrorMessage(error) ??
            'Transaction could not be saved. Check your connection.',
      );
    }
  }

  void _showError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final labelStyle = TextStyle(
      fontSize: 12.5,
      fontWeight: FontWeight.w600,
      color: AppColors.textSecondary(isDark),
    );

    return Padding(
      padding: EdgeInsets.only(
        left: 24,
        right: 24,
        top: 24,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Add Transaction',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 16),
            Text('Type', style: labelStyle),
            const SizedBox(height: 8),
            SegmentedButton<String>(
              segments: [
                for (final type in _transactionTypes)
                  ButtonSegment(value: type, label: Text(_titleCase(type))),
              ],
              selected: {_type},
              showSelectedIcon: false,
              onSelectionChanged: (selection) => setState(() {
                _type = selection.first;
                if (!_isTransfer) _toAccountId = null;
              }),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _amountController,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: const InputDecoration(
                labelText: 'Amount (₹)',
                hintText: 'e.g. 450',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _categoryController,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: 'Category',
                hintText: 'e.g. Food & Dining',
              ),
            ),
            const SizedBox(height: 12),
            if (_accounts.isNotEmpty)
              DropdownButtonFormField<String?>(
                key: ValueKey('from-${_isTransfer ? 'transfer' : 'normal'}'),
                initialValue: _accountId,
                decoration: InputDecoration(
                  labelText: _isTransfer ? 'From Account' : 'Account',
                ),
                hint: _isTransfer
                    ? const Text('Select source account')
                    : null,
                items: [
                  if (!_isTransfer)
                    const DropdownMenuItem<String?>(
                      value: null,
                      child: Text('Default account'),
                    ),
                  for (final account in _accounts)
                    DropdownMenuItem<String?>(
                      value: account.id,
                      child: Text(
                        account.name,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                ],
                onChanged: (value) => setState(() {
                  _accountId = value;
                  if (_toAccountId != null && _toAccountId == value) {
                    _toAccountId = null;
                  }
                }),
              ),
            if (_accounts.isNotEmpty) const SizedBox(height: 12),
            if (_isTransfer && _accounts.isNotEmpty)
              DropdownButtonFormField<String?>(
                key: ValueKey('to-${_accountId ?? 'unset'}'),
                initialValue: _toAccountId,
                decoration: const InputDecoration(labelText: 'To Account'),
                hint: const Text('Select destination account'),
                items: [
                  for (final account in _accounts)
                    if (account.id != _accountId)
                      DropdownMenuItem<String?>(
                        value: account.id,
                        child: Text(
                          account.name,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                ],
                onChanged: (value) => setState(() => _toAccountId = value),
              ),
            if (_isTransfer && _accounts.isNotEmpty)
              const SizedBox(height: 12),
            TextField(
              controller: _merchantController,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: 'Merchant (optional)',
                hintText: 'e.g. Swiggy',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _descriptionController,
              decoration: const InputDecoration(
                labelText: 'Description (optional)',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _paymentMethodController,
              decoration: const InputDecoration(
                labelText: 'Payment Method (optional)',
                hintText: 'e.g. UPI, Card, Cash',
              ),
            ),
            const SizedBox(height: 12),
            InkWell(
              onTap: _pickDate,
              borderRadius: BorderRadius.circular(12),
              child: InputDecorator(
                decoration: const InputDecoration(
                  labelText: 'Date',
                  suffixIcon: Icon(Icons.calendar_today_rounded, size: 18),
                ),
                child: Text(_formatDate(_date)),
              ),
            ),
            const SizedBox(height: 24),
            GradientButton(
              text: _isSaving ? 'Saving…' : 'Save Transaction',
              onPressed: _isSaving ? null : _submit,
            ),
          ],
        ),
      ),
    );
  }

  static String _titleCase(String value) =>
      value[0] + value.substring(1).toLowerCase();

  static String _formatDate(DateTime date) {
    final local = date.toLocal();
    final day = local.day.toString().padLeft(2, '0');
    final month = local.month.toString().padLeft(2, '0');
    return '$day/$month/${local.year}';
  }
}
