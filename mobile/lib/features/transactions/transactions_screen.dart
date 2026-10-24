import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/models/transaction_model.dart';
import '../../core/utils/date_formatter.dart';
import '../../shared/widgets/empty_state_view.dart';
import '../../shared/widgets/error_state_view.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/transaction_tile.dart';
import 'add_transaction_sheet.dart';

class TransactionsScreen extends StatefulWidget {
  const TransactionsScreen({super.key});

  @override
  State<TransactionsScreen> createState() => _TransactionsScreenState();
}

class _TransactionsScreenState extends State<TransactionsScreen> {
  static const _pageSize = 20;

  bool _isLoading = true;
  bool _isLoadingMore = false;
  String? _errorMessage;
  List<TransactionModel> _transactions = [];
  String _filterType = 'ALL'; // ALL, EXPENSE, INCOME
  String _searchQuery = '';
  int _page = 1;
  bool _hasMore = false;
  int _requestId = 0;
  Timer? _searchDebounce;
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _fetchTransactions(reset: true);
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _fetchTransactions({bool reset = false}) async {
    if (!reset && (_isLoadingMore || !_hasMore)) return;

    final requestId = ++_requestId;

    if (reset) {
      _page = 1;
      setState(() {
        _isLoading = true;
        _errorMessage = null;
      });
    } else {
      setState(() => _isLoadingMore = true);
    }

    try {
      final res = await apiClient.get(
        ApiEndpoints.transactions,
        queryParameters: {
          'page': _page,
          'limit': _pageSize,
          if (_filterType != 'ALL') 'type': _filterType,
          if (_searchQuery.isNotEmpty) 'search': _searchQuery,
        },
      );

      if (!mounted || requestId != _requestId) return;

      if (res.statusCode == 200 && res.data['success'] == true) {
        final data = res.data['data'];
        final dynamic raw = data is Map ? data['transactions'] : data;
        if (raw is! List) {
          throw const FormatException('Transactions response missing list');
        }

        final list = raw
            .whereType<Map>()
            .map(
              (json) =>
                  TransactionModel.fromJson(Map<String, dynamic>.from(json)),
            )
            .toList();

        final pagination = data is Map ? data['pagination'] : null;
        final totalPages = pagination is Map
            ? int.tryParse(pagination['totalPages']?.toString() ?? '')
            : null;
        final hasMore = totalPages != null
            ? _page < totalPages
            : list.length >= _pageSize;

        setState(() {
          _transactions = reset ? list : [..._transactions, ...list];
          _hasMore = hasMore;
          _page += 1;
          _isLoading = false;
          _isLoadingMore = false;
        });
      } else {
        _handleLoadFailure(
          'The server returned an unexpected response (${res.statusCode}).',
          reset: reset,
        );
      }
    } on DioException catch (e) {
      if (!mounted || requestId != _requestId) return;
      final status = e.response?.statusCode;
      _handleLoadFailure(
        status != null
            ? 'The server could not load transactions (HTTP $status). Please try again.'
            : 'Transactions could not be loaded. Check your connection and try again.',
        reset: reset,
      );
    } catch (_) {
      if (!mounted || requestId != _requestId) return;
      _handleLoadFailure(
        'Transactions could not be loaded. Check your connection and try again.',
        reset: reset,
      );
    }
  }

  void _handleLoadFailure(String message, {required bool reset}) {
    setState(() {
      _isLoading = false;
      _isLoadingMore = false;
      if (reset) {
        // Results from the previous filter/search must not be presented as if
        // they answered the new query.
        _transactions = const [];
        _hasMore = false;
        _errorMessage = message;
      }
    });
    if (!reset) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(message)));
    }
  }

  void _onSearchChanged(String value) {
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 400), () {
      final query = value.trim();
      if (query == _searchQuery) return;
      setState(() => _searchQuery = query);
      _fetchTransactions(reset: true);
    });
  }

  void _clearSearch() {
    _searchDebounce?.cancel();
    _searchController.clear();
    if (_searchQuery.isEmpty) return;
    setState(() => _searchQuery = '');
    _fetchTransactions(reset: true);
  }

  void _setFilter(String type) {
    if (_filterType == type) return;
    _searchDebounce?.cancel();
    _searchQuery = _searchController.text.trim();
    setState(() => _filterType = type);
    _fetchTransactions(reset: true);
  }

  Future<void> _openAddTransaction() async {
    await AddTransactionSheet.show(
      context,
      onCreated: (message) {
        if (!mounted) return;
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(message)));
        _fetchTransactions(reset: true);
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final items = _transactions;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Transaction History'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: () {
              _searchDebounce?.cancel();
              _searchQuery = _searchController.text.trim();
              _fetchTransactions(reset: true);
            },
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _openAddTransaction,
        icon: const Icon(Icons.add_rounded),
        label: const Text('Add'),
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
                  onChanged: _onSearchChanged,
                  decoration: InputDecoration(
                    hintText: 'Search merchant, description, category...',
                    prefixIcon: const Icon(Icons.search_rounded, size: 20),
                    suffixIcon: _searchQuery.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.clear_rounded, size: 18),
                            onPressed: _clearSearch,
                          )
                        : null,
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    _buildFilterChip(isDark, 'ALL', 'All'),
                    const SizedBox(width: 8),
                    _buildFilterChip(isDark, 'EXPENSE', 'Expenses'),
                    const SizedBox(width: 8),
                    _buildFilterChip(isDark, 'INCOME', 'Income'),
                  ],
                ),
              ],
            ),
          ),

          // Transactions list
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : _errorMessage != null
                ? ErrorStateView(
                    message: _errorMessage!,
                    onRetry: () => _fetchTransactions(reset: true),
                  )
                : items.isEmpty
                ? EmptyStateView(
                    icon: Icons.receipt_long_rounded,
                    title: 'No Transactions Found',
                    description: _searchQuery.isNotEmpty
                        ? 'No matches found for "$_searchQuery"'
                        : 'No transactions recorded yet.',
                  )
                : RefreshIndicator(
                    onRefresh: () => _fetchTransactions(reset: true),
                    child: ListView.builder(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 18,
                        vertical: 8,
                      ),
                      itemCount: items.length + (_hasMore ? 1 : 0),
                      itemBuilder: (context, index) {
                        if (index >= items.length) {
                          return Padding(
                            padding: const EdgeInsets.symmetric(vertical: 12),
                            child: Center(
                              child: _isLoadingMore
                                  ? const SizedBox(
                                      width: 22,
                                      height: 22,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2.5,
                                      ),
                                    )
                                  : TextButton(
                                      onPressed: () => _fetchTransactions(),
                                      child: const Text('Load more'),
                                    ),
                            ),
                          );
                        }

                        final tx = items[index];
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: TransactionTile(
                            tx: tx,
                            subtitle:
                                '${tx.categoryName} • ${DateFormatter.format(tx.date)}',
                            onTap: () async {
                              await context.push('/transactions/${tx.id}');
                              // The detail screen can delete the record, so
                              // refresh when it returns.
                              if (mounted) _fetchTransactions(reset: true);
                            },
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

  Widget _buildFilterChip(bool isDark, String type, String label) {
    final isSelected = _filterType == type;
    return Pressable(
      onTap: () => _setFilter(type),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
        decoration: BoxDecoration(
          color: isSelected ? AppColors.primary : AppColors.surface(isDark),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isSelected ? AppColors.primary : AppColors.border(isDark),
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12.5,
            fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
            color: isSelected ? Colors.white : AppColors.textSecondary(isDark),
          ),
        ),
      ),
    );
  }
}
