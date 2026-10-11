import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/models/transaction_model.dart';
import '../../core/utils/currency_formatter.dart';
import '../../core/utils/date_formatter.dart';
import '../../shared/widgets/empty_state_view.dart';
import '../../shared/widgets/financial_card.dart';

class TransactionsScreen extends StatefulWidget {
  const TransactionsScreen({super.key});

  @override
  State<TransactionsScreen> createState() => _TransactionsScreenState();
}

class _TransactionsScreenState extends State<TransactionsScreen> {
  bool _isLoading = true;
  List<TransactionModel> _transactions = [];
  String _filterType = 'ALL'; // ALL, EXPENSE, INCOME
  String _searchQuery = '';
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _fetchTransactions();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _fetchTransactions() async {
    setState(() => _isLoading = true);
    try {
      final res = await apiClient.get(ApiEndpoints.transactions);
      if (res.statusCode == 200 && res.data['success'] == true) {
        final list = (res.data['data']['transactions'] ?? res.data['data'] as List)
            .map((json) => TransactionModel.fromJson(json))
            .toList();
        setState(() {
          _transactions = list;
          _isLoading = false;
        });
      }
    } catch (_) {
      setState(() => _isLoading = false);
    }
  }

  List<TransactionModel> get _filteredTransactions {
    return _transactions.where((tx) {
      if (_filterType == 'EXPENSE' && tx.isIncome) return false;
      if (_filterType == 'INCOME' && !tx.isIncome) return false;
      if (_searchQuery.isNotEmpty) {
        final query = _searchQuery.toLowerCase();
        final merchant = (tx.merchant ?? '').toLowerCase();
        final desc = (tx.description ?? '').toLowerCase();
        final cat = tx.categoryName.toLowerCase();
        return merchant.contains(query) || desc.contains(query) || cat.contains(query);
      }
      return true;
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final items = _filteredTransactions;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Transaction History'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _fetchTransactions,
          ),
        ],
      ),
      body: Column(
        children: [
          // Search & Filter header
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
            child: Column(
              children: [
                TextField(
                  controller: _searchController,
                  onChanged: (val) => setState(() => _searchQuery = val.trim()),
                  decoration: InputDecoration(
                    hintText: 'Search merchant, description, category...',
                    prefixIcon: const Icon(Icons.search_rounded, size: 20),
                    suffixIcon: _searchQuery.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.clear_rounded, size: 18),
                            onPressed: () {
                              _searchController.clear();
                              setState(() => _searchQuery = '');
                            },
                          )
                        : null,
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    _buildFilterChip('ALL', 'All'),
                    const SizedBox(width: 8),
                    _buildFilterChip('EXPENSE', 'Expenses'),
                    const SizedBox(width: 8),
                    _buildFilterChip('INCOME', 'Income'),
                  ],
                ),
              ],
            ),
          ),

          // Transactions list
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : items.isEmpty
                    ? EmptyStateView(
                        icon: Icons.receipt_long_rounded,
                        title: 'No Transactions Found',
                        description: _searchQuery.isNotEmpty
                            ? 'No matches found for "$_searchQuery"'
                            : 'No transactions recorded yet.',
                      )
                    : RefreshIndicator(
                        onRefresh: _fetchTransactions,
                        child: ListView.builder(
                          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
                          itemCount: items.length,
                          itemBuilder: (context, index) {
                            final tx = items[index];
                            return Padding(
                              padding: const EdgeInsets.only(bottom: 8),
                              child: FinancialCard(
                                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                                onTap: () => context.push('/transactions/${tx.id}'),
                                child: Row(
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.all(10),
                                      decoration: BoxDecoration(
                                        color: tx.isIncome ? AppColors.incomeBadgeBg : AppColors.expenseBadgeBg,
                                        shape: BoxShape.circle,
                                      ),
                                      child: Icon(
                                        tx.isIncome ? Icons.arrow_downward_rounded : Icons.arrow_upward_rounded,
                                        size: 16,
                                        color: tx.isIncome ? AppColors.income : AppColors.expense,
                                      ),
                                    ),
                                    const SizedBox(width: 14),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            tx.merchant ?? tx.description ?? 'Transaction',
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
                                          ),
                                          Text(
                                            '${tx.categoryName} • ${DateFormatter.format(tx.date)}',
                                            style: const TextStyle(fontSize: 12, color: AppColors.darkTextSecondary),
                                          ),
                                        ],
                                      ),
                                    ),
                                    Text(
                                      '${tx.isIncome ? "+" : "-"}${CurrencyFormatter.format(tx.amount)}',
                                      style: TextStyle(
                                        fontSize: 15,
                                        fontWeight: FontWeight.w700,
                                        color: tx.isIncome ? AppColors.income : (isDark ? AppColors.darkTextPrimary : AppColors.lightTextPrimary),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
                      ),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterChip(String type, String label) {
    final isSelected = _filterType == type;
    return InkWell(
      onTap: () => setState(() => _filterType = type),
      borderRadius: BorderRadius.circular(20),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        decoration: BoxDecoration(
          color: isSelected ? AppColors.primary : Colors.transparent,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isSelected ? AppColors.primary : AppColors.darkBorder,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12.5,
            fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
            color: isSelected ? Colors.white : AppColors.darkTextSecondary,
          ),
        ),
      ),
    );
  }
}
