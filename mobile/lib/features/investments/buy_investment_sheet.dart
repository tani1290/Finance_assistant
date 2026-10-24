import 'package:flutter/material.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/api/api_error.dart';
import '../../shared/widgets/gradient_button.dart';

/// Bottom sheet that records a purchase through `POST /investments/buy`,
/// mirroring the web "Buy Investment" modal.
///
/// The backend matches holdings by symbol: buying a symbol that is already
/// held increases the quantity and recalculates the average buy price.
class BuyInvestmentSheet extends StatefulWidget {
  const BuyInvestmentSheet({super.key, required this.onCreated});

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
      builder: (_) => BuyInvestmentSheet(onCreated: onCreated),
    );
  }

  @override
  State<BuyInvestmentSheet> createState() => _BuyInvestmentSheetState();
}

class _BuyInvestmentSheetState extends State<BuyInvestmentSheet> {
  static const _assetTypes = [
    'STOCK',
    'MUTUAL_FUND',
    'SIP',
    'GOLD',
    'SILVER',
    'FIXED_DEPOSIT',
    'CRYPTO',
    'BOND',
  ];

  final _symbolController = TextEditingController();
  final _nameController = TextEditingController();
  final _quantityController = TextEditingController();
  final _priceController = TextEditingController();

  String _assetType = 'STOCK';
  bool _isSaving = false;

  @override
  void dispose() {
    _symbolController.dispose();
    _nameController.dispose();
    _quantityController.dispose();
    _priceController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final symbol = _symbolController.text.trim().toUpperCase();
    final quantity = double.tryParse(_quantityController.text.trim());
    final price = double.tryParse(_priceController.text.trim());

    if (symbol.isEmpty) {
      _showError('Enter the instrument symbol.');
      return;
    }
    if (quantity == null || quantity <= 0) {
      _showError('Enter a quantity greater than zero.');
      return;
    }
    if (price == null || price <= 0) {
      _showError('Enter a buy price greater than zero.');
      return;
    }

    setState(() => _isSaving = true);
    try {
      final name = _nameController.text.trim();
      final res = await apiClient.post(
        ApiEndpoints.investmentBuy,
        data: {
          'symbol': symbol,
          if (name.isNotEmpty) 'name': name,
          'assetType': _assetType,
          'quantity': quantity,
          'buyPrice': price,
        },
      );
      if (!mounted) return;

      Navigator.pop(context);
      widget.onCreated(serverMessage(res.data) ?? 'Investment added.');
    } catch (error) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      _showError(
        apiErrorMessage(error) ??
            'Investment could not be saved. Check your connection.',
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
              'Buy Investment',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 6),
            Text(
              'Buying a symbol you already hold adds to that holding at a new '
              'average price.',
              style: TextStyle(
                fontSize: 12.5,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _symbolController,
              textCapitalization: TextCapitalization.characters,
              decoration: const InputDecoration(
                labelText: 'Symbol',
                hintText: 'e.g. RELIANCE',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _nameController,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: 'Name (optional)',
                hintText: 'e.g. Reliance Industries',
              ),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _assetType,
              decoration: const InputDecoration(labelText: 'Asset type'),
              items: [
                for (final type in _assetTypes)
                  DropdownMenuItem<String>(
                    value: type,
                    child: Text(_label(type)),
                  ),
              ],
              onChanged: (value) {
                if (value != null) setState(() => _assetType = value);
              },
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _quantityController,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: const InputDecoration(
                labelText: 'Quantity',
                hintText: 'e.g. 10',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _priceController,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: const InputDecoration(
                labelText: 'Buy price per unit (₹)',
                hintText: 'e.g. 2450.50',
              ),
            ),
            const SizedBox(height: 24),
            GradientButton(
              text: _isSaving ? 'Saving…' : 'Record Purchase',
              onPressed: _isSaving ? null : _submit,
            ),
          ],
        ),
      ),
    );
  }

  static String _label(String value) {
    final words = value.split('_');
    return words
        .map((word) => word[0] + word.substring(1).toLowerCase())
        .join(' ');
  }
}
