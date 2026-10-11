import 'package:flutter/material.dart';
import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/models/pending_sms_model.dart';
import '../../core/utils/currency_formatter.dart';
import '../../core/utils/date_formatter.dart';
import '../../shared/widgets/empty_state_view.dart';
import '../../shared/widgets/financial_card.dart';
import '../../shared/widgets/gradient_button.dart';
import '../../shared/widgets/status_badge.dart';

class PendingSmsScreen extends StatefulWidget {
  const PendingSmsScreen({super.key});

  @override
  State<PendingSmsScreen> createState() => _PendingSmsScreenState();
}

class _PendingSmsScreenState extends State<PendingSmsScreen> {
  bool _isLoading = true;
  List<PendingSmsModel> _pendingItems = [];
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _loadPendingSms();
  }

  Future<void> _loadPendingSms() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final res = await apiClient.get(ApiEndpoints.smsPending);
      if (res.statusCode == 200 && res.data['success'] == true) {
        final list = (res.data['data'] as List)
            .map((json) => PendingSmsModel.fromJson(json))
            .toList();
        setState(() {
          _pendingItems = list;
          _isLoading = false;
        });
      }
    } catch (e) {
      setState(() {
        _errorMessage = 'Failed to load pending SMS transactions.';
        _isLoading = false;
      });
    }
  }

  Future<void> _handleConfirm(
    PendingSmsModel item, {
    String? newCategory,
    String? newMerchant,
  }) async {
    try {
      final payload = <String, dynamic>{};
      if (newCategory != null) payload['categoryName'] = newCategory;
      if (newMerchant != null) payload['merchant'] = newMerchant;

      final res = await apiClient.post(
        ApiEndpoints.smsPendingConfirm(item.id),
        data: payload,
      );

      if (res.statusCode == 200 && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Confirmed ₹${item.amount.toStringAsFixed(0)} to ledger!',
            ),
            backgroundColor: AppColors.primary,
          ),
        );
        _loadPendingSms();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to confirm transaction')),
        );
      }
    }
  }

  Future<void> _handleReject(PendingSmsModel item) async {
    try {
      final res = await apiClient.post(ApiEndpoints.smsPendingReject(item.id));
      if (res.statusCode == 200 && mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Candidate rejected.')));
        _loadPendingSms();
      }
    } catch (_) {}
  }

  void _showConfirmDialog(PendingSmsModel item) {
    final catController = TextEditingController(
      text: item.suggestedCategory ?? 'General',
    );
    final merchantController = TextEditingController(text: item.merchant ?? '');

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => Padding(
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
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'Confirm Transaction',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                ),
                IconButton(
                  icon: const Icon(Icons.close_rounded),
                  onPressed: () => Navigator.pop(ctx),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Text(
              '${item.isIncome ? "+" : "-"}${CurrencyFormatter.format(item.amount)}',
              style: TextStyle(
                fontSize: 28,
                fontWeight: FontWeight.w800,
                color: item.isIncome ? AppColors.income : AppColors.expense,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Detected from ${item.rawSender ?? "Bank SMS"} • ${DateFormatter.formatWithTime(item.transactionDate)}',
              style: const TextStyle(
                fontSize: 12,
                color: AppColors.darkTextSecondary,
              ),
            ),
            const SizedBox(height: 18),
            const Text(
              'Merchant / Payee',
              style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
            ),
            const SizedBox(height: 6),
            TextField(
              controller: merchantController,
              decoration: const InputDecoration(hintText: 'Merchant name'),
            ),
            const SizedBox(height: 14),
            const Text(
              'Category',
              style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
            ),
            const SizedBox(height: 6),
            TextField(
              controller: catController,
              decoration: const InputDecoration(
                hintText: 'e.g. Food & Dining, Shopping, Utilities',
              ),
            ),
            const SizedBox(height: 8),
            if (item.categoryReason != null)
              Text(
                '💡 AI Reason: ${item.categoryReason}',
                style: const TextStyle(
                  fontSize: 11.5,
                  color: AppColors.primaryLight,
                ),
              ),
            const SizedBox(height: 24),
            GradientButton(
              text: 'Confirm into Accounts Ledger',
              onPressed: () {
                Navigator.pop(ctx);
                _handleConfirm(
                  item,
                  newCategory: catController.text.trim(),
                  newMerchant: merchantController.text.trim(),
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  void _showSimulateSmsDialog() {
    final textController = TextEditingController(
      text:
          'Rs. 450.00 debited from A/c XX1234 on 10-Oct-2026 at SWIGGY. Avl Bal Rs 15,200.',
    );
    final senderController = TextEditingController(text: 'HDFCBK');

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text(
          'Simulate Bank SMS Ingestion',
          style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Test the SMS detection and categorization engine directly:',
              style: TextStyle(fontSize: 13),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: senderController,
              decoration: const InputDecoration(
                labelText: 'Sender Tag (e.g. HDFCBK, SBIBNK)',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: textController,
              maxLines: 3,
              decoration: const InputDecoration(labelText: 'SMS Body Text'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(ctx);
              try {
                final res = await apiClient.post(
                  ApiEndpoints.smsIngest,
                  data: {
                    'messageText': textController.text.trim(),
                    'sender': senderController.text.trim(),
                  },
                );

                if (res.statusCode == 201 && mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('SMS ingested into pending review!'),
                    ),
                  );
                  _loadPendingSms();
                }
              } catch (e) {
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Failed to ingest candidate')),
                  );
                }
              }
            },
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.primary),
            child: const Text(
              'Ingest SMS',
              style: TextStyle(color: Colors.white),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Pending SMS Transactions'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add_comment_rounded),
            tooltip: 'Simulate/Test SMS',
            onPressed: _showSimulateSmsDialog,
          ),
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _loadPendingSms,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _errorMessage != null
          ? Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(_errorMessage!),
                  const SizedBox(height: 12),
                  ElevatedButton(
                    onPressed: _loadPendingSms,
                    child: const Text('Retry'),
                  ),
                ],
              ),
            )
          : _pendingItems.isEmpty
          ? EmptyStateView(
              icon: Icons.mark_email_read_rounded,
              title: 'All Caught Up!',
              description:
                  'No pending SMS transactions awaiting review. Incoming banking alerts will appear here.',
              actionLabel: 'Simulate a Bank SMS',
              onAction: _showSimulateSmsDialog,
            )
          : ListView.builder(
              padding: const EdgeInsets.all(18),
              itemCount: _pendingItems.length,
              itemBuilder: (context, index) {
                final item = _pendingItems[index];
                return Padding(
                  padding: const EdgeInsets.only(bottom: 14),
                  child: FinancialCard(
                    padding: const EdgeInsets.all(18),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Row(
                              children: [
                                StatusBadge(
                                  label: item.isIncome ? 'Credit' : 'Debit',
                                  color: item.isIncome
                                      ? AppColors.income
                                      : AppColors.expense,
                                ),
                                const SizedBox(width: 8),
                                if (item.isDuplicate) StatusBadge.duplicate(),
                              ],
                            ),
                            Text(
                              DateFormatter.relative(item.transactionDate),
                              style: const TextStyle(
                                fontSize: 12,
                                color: AppColors.darkTextSecondary,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    item.merchant ?? 'Merchant',
                                    style: const TextStyle(
                                      fontSize: 16,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    'Category: ${item.suggestedCategory ?? "General"}',
                                    style: const TextStyle(
                                      fontSize: 12.5,
                                      color: AppColors.darkTextSecondary,
                                    ),
                                  ),
                                  if (item.accountHint != null)
                                    Text(
                                      'Account Ending: •••• ${item.accountHint}',
                                      style: const TextStyle(
                                        fontSize: 12,
                                        color: AppColors.darkTextSecondary,
                                      ),
                                    ),
                                ],
                              ),
                            ),
                            Text(
                              '${item.isIncome ? "+" : "-"}${CurrencyFormatter.format(item.amount)}',
                              style: TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.w800,
                                color: item.isIncome
                                    ? AppColors.income
                                    : (isDark
                                          ? AppColors.darkTextPrimary
                                          : AppColors.lightTextPrimary),
                              ),
                            ),
                          ],
                        ),
                        if (item.duplicateReason != null) ...[
                          const SizedBox(height: 10),
                          Container(
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(
                              color: AppColors.purple.withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Text(
                              '⚠️ ${item.duplicateReason}',
                              style: const TextStyle(
                                fontSize: 11.5,
                                color: AppColors.purple,
                              ),
                            ),
                          ),
                        ],
                        const SizedBox(height: 16),
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton(
                                onPressed: () => _handleReject(item),
                                style: OutlinedButton.styleFrom(
                                  foregroundColor: AppColors.expense,
                                  side: const BorderSide(
                                    color: AppColors.darkBorder,
                                  ),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(10),
                                  ),
                                ),
                                child: const Text('Reject'),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: ElevatedButton(
                                onPressed: () => _showConfirmDialog(item),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: AppColors.primary,
                                  foregroundColor: Colors.white,
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(10),
                                  ),
                                ),
                                child: const Text(
                                  'Confirm',
                                  style: TextStyle(fontWeight: FontWeight.w600),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
    );
  }
}
