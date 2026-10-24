import 'package:flutter/material.dart';

import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/api/api_error.dart';
import '../../core/utils/date_formatter.dart';
import '../../shared/widgets/gradient_button.dart';

/// Bottom sheet that records a subscription through `POST /subscriptions`.
///
/// The service name, cost and next billing date are required. The billing date
/// is a calendar date, sent as `YYYY-MM-DD`; the backend defaults the category
/// to `Entertainment` when it is omitted.
class AddSubscriptionSheet extends StatefulWidget {
  const AddSubscriptionSheet({super.key, required this.onCreated});

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
      builder: (_) => AddSubscriptionSheet(onCreated: onCreated),
    );
  }

  @override
  State<AddSubscriptionSheet> createState() => _AddSubscriptionSheetState();
}

class _AddSubscriptionSheetState extends State<AddSubscriptionSheet> {
  /// Mirrors the cycles the backend's monthly-cost normalisation understands
  /// (`ANNUAL` ÷12, `QUARTERLY` ÷3, anything else treated as monthly).
  static const _billingCycles = ['MONTHLY', 'QUARTERLY', 'ANNUAL'];

  static const _categories = [
    'Entertainment',
    'Music',
    'Software',
    'Health',
    'Education',
    'Utilities',
    'Other',
  ];

  final _nameController = TextEditingController();
  final _costController = TextEditingController();

  String _billingCycle = 'MONTHLY';
  String _category = 'Entertainment';
  DateTime _nextBillingDate = DateTime.now().add(const Duration(days: 30));
  bool _isSaving = false;

  @override
  void dispose() {
    _nameController.dispose();
    _costController.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _nextBillingDate,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (picked != null && mounted) setState(() => _nextBillingDate = picked);
  }

  Future<void> _submit() async {
    final name = _nameController.text.trim();
    final cost = double.tryParse(_costController.text.trim());

    if (name.isEmpty) {
      _showError('Give the subscription a name.');
      return;
    }
    if (cost == null || cost <= 0) {
      _showError('Enter a cost greater than zero.');
      return;
    }

    setState(() => _isSaving = true);
    try {
      await apiClient.post(
        ApiEndpoints.subscriptions,
        data: {
          'serviceName': name,
          'cost': cost,
          'billingCycle': _billingCycle,
          'nextBillingDate': DateFormatter.toDateOnly(_nextBillingDate),
          'category': _category,
        },
      );
      if (!mounted) return;

      Navigator.pop(context);
      widget.onCreated('Subscription added.');
    } catch (error) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      _showError(
        apiErrorMessage(error) ??
            'Subscription could not be saved. Check your connection.',
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
              'Add Subscription',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _nameController,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: 'Service name',
                hintText: 'e.g. Netflix',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _costController,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: const InputDecoration(
                labelText: 'Cost (₹)',
                hintText: 'e.g. 649',
              ),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _billingCycle,
              decoration: const InputDecoration(labelText: 'Billing cycle'),
              items: [
                for (final cycle in _billingCycles)
                  DropdownMenuItem<String>(
                    value: cycle,
                    child: Text(_titleCase(cycle)),
                  ),
              ],
              onChanged: (value) {
                if (value != null) setState(() => _billingCycle = value);
              },
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _category,
              decoration: const InputDecoration(labelText: 'Category'),
              items: [
                for (final category in _categories)
                  DropdownMenuItem<String>(
                    value: category,
                    child: Text(category),
                  ),
              ],
              onChanged: (value) {
                if (value != null) setState(() => _category = value);
              },
            ),
            const SizedBox(height: 12),
            InkWell(
              onTap: _pickDate,
              borderRadius: BorderRadius.circular(12),
              child: InputDecorator(
                decoration: const InputDecoration(
                  labelText: 'Next billing date',
                  suffixIcon: Icon(Icons.calendar_today_rounded, size: 18),
                ),
                child: Text(DateFormatter.format(_nextBillingDate)),
              ),
            ),
            const SizedBox(height: 24),
            GradientButton(
              text: _isSaving ? 'Saving…' : 'Save Subscription',
              onPressed: _isSaving ? null : _submit,
            ),
          ],
        ),
      ),
    );
  }
}

String _titleCase(String value) {
  if (value.isEmpty) return value;
  final words = value.split('_');
  return words
      .map((w) => w.isEmpty ? w : w[0].toUpperCase() + w.substring(1).toLowerCase())
      .join(' ');
}
