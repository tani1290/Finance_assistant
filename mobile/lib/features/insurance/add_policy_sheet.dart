import 'package:flutter/material.dart';

import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/api/api_error.dart';
import '../../core/utils/date_formatter.dart';
import '../../shared/widgets/gradient_button.dart';

/// Bottom sheet that records an insurance policy through `POST /insurance`.
///
/// Coverage, premium and the renewal date are required by the API; the insurer
/// name is optional. The renewal date is a calendar date, so it is sent as
/// `YYYY-MM-DD` rather than a timestamp.
class AddPolicySheet extends StatefulWidget {
  const AddPolicySheet({super.key, required this.onCreated});

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
      builder: (_) => AddPolicySheet(onCreated: onCreated),
    );
  }

  @override
  State<AddPolicySheet> createState() => _AddPolicySheetState();
}

class _AddPolicySheetState extends State<AddPolicySheet> {
  static const _policyTypes = [
    'LIFE',
    'HEALTH',
    'VEHICLE',
    'HOME',
    'TRAVEL',
    'OTHER',
  ];

  /// Mirrors the cycles the backend's annual-premium normalisation understands
  /// (`MONTHLY` ×12, `HALF_YEARLY` ×2, `QUARTERLY` ×4, anything else ×1).
  static const _premiumCycles = ['ANNUAL', 'HALF_YEARLY', 'QUARTERLY', 'MONTHLY'];

  final _nameController = TextEditingController();
  final _insurerController = TextEditingController();
  final _coverageController = TextEditingController();
  final _premiumController = TextEditingController();

  String _policyType = 'LIFE';
  String _premiumCycle = 'ANNUAL';
  DateTime _renewalDate = DateTime.now().add(const Duration(days: 365));
  bool _isSaving = false;

  @override
  void dispose() {
    _nameController.dispose();
    _insurerController.dispose();
    _coverageController.dispose();
    _premiumController.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _renewalDate,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (picked != null && mounted) setState(() => _renewalDate = picked);
  }

  Future<void> _submit() async {
    final name = _nameController.text.trim();
    final coverage = double.tryParse(_coverageController.text.trim());
    final premium = double.tryParse(_premiumController.text.trim());

    if (name.isEmpty) {
      _showError('Give the policy a name.');
      return;
    }
    if (coverage == null || coverage <= 0) {
      _showError('Enter a coverage amount greater than zero.');
      return;
    }
    if (premium == null || premium <= 0) {
      _showError('Enter a premium greater than zero.');
      return;
    }

    setState(() => _isSaving = true);
    try {
      await apiClient.post(
        ApiEndpoints.insurance,
        data: {
          'policyName': name,
          'insurer': ?_nullableText(_insurerController.text),
          'policyType': _policyType,
          'coverageAmount': coverage,
          'premium': premium,
          'premiumCycle': _premiumCycle,
          'renewalDate': DateFormatter.toDateOnly(_renewalDate),
        },
      );
      if (!mounted) return;

      Navigator.pop(context);
      widget.onCreated('Policy added.');
    } catch (error) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      _showError(
        apiErrorMessage(error) ??
            'Policy could not be saved. Check your connection.',
      );
    }
  }

  static String? _nullableText(String value) {
    final trimmed = value.trim();
    return trimmed.isEmpty ? null : trimmed;
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
              'Add Insurance Policy',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _nameController,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: 'Policy name',
                hintText: 'e.g. HDFC Life Click 2 Protect',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _insurerController,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: 'Insurer (optional)',
                hintText: 'e.g. HDFC Life',
              ),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _policyType,
              decoration: const InputDecoration(labelText: 'Policy type'),
              items: [
                for (final type in _policyTypes)
                  DropdownMenuItem<String>(
                    value: type,
                    child: Text(_titleCase(type)),
                  ),
              ],
              onChanged: (value) {
                if (value != null) setState(() => _policyType = value);
              },
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _coverageController,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: const InputDecoration(
                labelText: 'Coverage amount (₹)',
                hintText: 'e.g. 10000000',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _premiumController,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: const InputDecoration(
                labelText: 'Premium (₹)',
                hintText: 'e.g. 12000',
              ),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _premiumCycle,
              decoration: const InputDecoration(labelText: 'Premium cycle'),
              items: [
                for (final cycle in _premiumCycles)
                  DropdownMenuItem<String>(
                    value: cycle,
                    child: Text(_titleCase(cycle)),
                  ),
              ],
              onChanged: (value) {
                if (value != null) setState(() => _premiumCycle = value);
              },
            ),
            const SizedBox(height: 12),
            InkWell(
              onTap: _pickDate,
              borderRadius: BorderRadius.circular(12),
              child: InputDecorator(
                decoration: const InputDecoration(
                  labelText: 'Renewal date',
                  suffixIcon: Icon(Icons.calendar_today_rounded, size: 18),
                ),
                child: Text(DateFormatter.format(_renewalDate)),
              ),
            ),
            const SizedBox(height: 24),
            GradientButton(
              text: _isSaving ? 'Saving…' : 'Save Policy',
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
