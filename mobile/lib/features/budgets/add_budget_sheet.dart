import 'package:flutter/material.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/api/api_error.dart';
import '../../shared/widgets/gradient_button.dart';

/// Bottom sheet that creates (or upserts) a monthly budget through
/// `POST /budgets`, mirroring the web "Add Budget" modal.
///
/// The backend defaults `month`/`year` to the current period, which is the
/// same period the list screen loads, so they are not asked for here.
class AddBudgetSheet extends StatefulWidget {
  const AddBudgetSheet({super.key, required this.onCreated});

  /// Invoked with the server's confirmation message after a successful save.
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
      builder: (_) => AddBudgetSheet(onCreated: onCreated),
    );
  }

  @override
  State<AddBudgetSheet> createState() => _AddBudgetSheetState();
}

class _AddBudgetSheetState extends State<AddBudgetSheet> {
  final _categoryController = TextEditingController();
  final _limitController = TextEditingController();
  bool _isSaving = false;

  @override
  void dispose() {
    _categoryController.dispose();
    _limitController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final category = _categoryController.text.trim();
    final limit = double.tryParse(_limitController.text.trim());

    if (category.isEmpty) {
      _showError('Enter a category name.');
      return;
    }
    if (limit == null || limit <= 0) {
      _showError('Enter a monthly limit greater than zero.');
      return;
    }

    setState(() => _isSaving = true);
    try {
      final res = await apiClient.post(
        ApiEndpoints.budgets,
        data: {'categoryName': category, 'monthlyLimit': limit},
      );
      if (!mounted) return;

      final message = serverMessage(res.data) ?? 'Budget saved.';
      Navigator.pop(context);
      widget.onCreated(message);
    } catch (error) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      _showError(
        apiErrorMessage(error) ??
            'Budget could not be saved. Check your connection.',
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
              'Set Monthly Budget',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _categoryController,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: 'Category',
                hintText: 'e.g. Food & Dining',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _limitController,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: const InputDecoration(
                labelText: 'Monthly limit (₹)',
                hintText: 'e.g. 12000',
              ),
            ),
            const SizedBox(height: 24),
            GradientButton(
              text: _isSaving ? 'Saving…' : 'Save Budget',
              onPressed: _isSaving ? null : _submit,
            ),
          ],
        ),
      ),
    );
  }
}
