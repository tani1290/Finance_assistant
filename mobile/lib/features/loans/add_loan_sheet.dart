import 'package:flutter/material.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/api/api_error.dart';
import '../../shared/widgets/gradient_button.dart';

/// Bottom sheet that records a loan through `POST /loans`, mirroring the web
/// "Add Loan" modal. The server computes the EMI from principal, rate and
/// tenure, so those three are required; the lender name is optional (it is
/// nullable in the schema).
class AddLoanSheet extends StatefulWidget {
  const AddLoanSheet({super.key, required this.onCreated});

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
      builder: (_) => AddLoanSheet(onCreated: onCreated),
    );
  }

  @override
  State<AddLoanSheet> createState() => _AddLoanSheetState();
}

class _AddLoanSheetState extends State<AddLoanSheet> {
  static const _loanTypes = [
    'PERSONAL',
    'HOME',
    'CAR',
    'EDUCATION',
    'BUSINESS',
    'GOLD',
    'OTHER',
  ];

  final _lenderController = TextEditingController();
  final _principalController = TextEditingController();
  final _rateController = TextEditingController();
  final _tenureController = TextEditingController();

  String _loanType = 'PERSONAL';
  DateTime _startDate = DateTime.now();
  bool _isSaving = false;

  @override
  void dispose() {
    _lenderController.dispose();
    _principalController.dispose();
    _rateController.dispose();
    _tenureController.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _startDate,
      firstDate: DateTime(1990),
      lastDate: DateTime(2100),
    );
    if (picked != null && mounted) setState(() => _startDate = picked);
  }

  Future<void> _submit() async {
    final principal = double.tryParse(_principalController.text.trim());
    final rate = double.tryParse(_rateController.text.trim());
    final tenure = int.tryParse(_tenureController.text.trim());

    if (principal == null || principal <= 0) {
      _showError('Enter a principal amount greater than zero.');
      return;
    }
    if (rate == null || rate <= 0) {
      _showError('Enter an annual interest rate greater than zero.');
      return;
    }
    if (tenure == null || tenure <= 0) {
      _showError('Enter a tenure in months.');
      return;
    }

    setState(() => _isSaving = true);
    try {
      await apiClient.post(
        ApiEndpoints.loans,
        data: {
          'loanType': _loanType,
          if (_lenderController.text.trim().isNotEmpty)
            'lenderName': _lenderController.text.trim(),
          'principalAmount': principal,
          'interestRate': rate,
          'tenureMonths': tenure,
          'startDate': _startDate.toUtc().toIso8601String(),
        },
      );
      if (!mounted) return;

      Navigator.pop(context);
      widget.onCreated('Loan added.');
    } catch (error) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      _showError(
        apiErrorMessage(error) ??
            'Loan could not be saved. Check your connection.',
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
              'Add Loan',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              initialValue: _loanType,
              decoration: const InputDecoration(labelText: 'Loan type'),
              items: [
                for (final type in _loanTypes)
                  DropdownMenuItem<String>(
                    value: type,
                    child: Text(_titleCase(type)),
                  ),
              ],
              onChanged: (value) {
                if (value != null) setState(() => _loanType = value);
              },
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _lenderController,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: 'Lender (optional)',
                hintText: 'e.g. HDFC Bank',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _principalController,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: const InputDecoration(
                labelText: 'Principal amount (₹)',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _rateController,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: const InputDecoration(
                labelText: 'Annual interest rate (%)',
                hintText: 'e.g. 8.5',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _tenureController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'Tenure (months)',
                hintText: 'e.g. 240',
              ),
            ),
            const SizedBox(height: 12),
            InkWell(
              onTap: _pickDate,
              borderRadius: BorderRadius.circular(12),
              child: InputDecorator(
                decoration: const InputDecoration(
                  labelText: 'Start date',
                  suffixIcon: Icon(Icons.calendar_today_rounded, size: 18),
                ),
                child: Text(_formatDate(_startDate)),
              ),
            ),
            const SizedBox(height: 24),
            GradientButton(
              text: _isSaving ? 'Saving…' : 'Save Loan',
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
