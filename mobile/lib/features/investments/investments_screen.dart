import 'package:flutter/material.dart';
import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/api/api_error.dart';
import '../../core/models/investment_model.dart';
import '../../core/utils/currency_formatter.dart';
import '../../shared/widgets/empty_state_view.dart';
import '../../shared/widgets/error_state_view.dart';
import '../../shared/widgets/financial_card.dart';
import '../../shared/widgets/skeleton_loader.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/summary_hero_card.dart';
import 'buy_investment_sheet.dart';

class InvestmentsScreen extends StatefulWidget {
  const InvestmentsScreen({super.key});

  @override
  State<InvestmentsScreen> createState() => _InvestmentsScreenState();
}

class _InvestmentsScreenState extends State<InvestmentsScreen> {
  bool _isLoading = true;
  double _totalPortfolioValue = 0.0;
  double _totalInvested = 0.0;
  double _returnsPercent = 0.0;
  List<InvestmentModel> _holdings = [];
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _fetchPortfolio();
  }

  Future<void> _fetchPortfolio() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });
    try {
      final res = await apiClient.get(ApiEndpoints.portfolio);
      if (res.statusCode == 200 && res.data['success'] == true) {
        final data = res.data['data'];
        if (data is! Map) {
          throw const FormatException('Portfolio response missing data');
        }
        // The endpoint returns `holdings`; accept the older `investments` key too.
        final rawHoldings = data['holdings'] ?? data['investments'];
        if (rawHoldings is! List) {
          throw const FormatException('Portfolio response missing holdings');
        }

        final holdings = rawHoldings
            .whereType<Map>()
            .map(
              (json) =>
                  InvestmentModel.fromJson(Map<String, dynamic>.from(json)),
            )
            .toList();

        // Prefer the server's authoritative totals; derive them from the
        // holdings only when the payload omits them.
        final totalValue =
            _parseAmount(data['currentValue']) ??
            holdings.fold<double>(0, (sum, h) => sum + h.currentValue);
        final totalInvested =
            _parseAmount(data['totalInvested']) ??
            holdings.fold<double>(0, (sum, h) => sum + h.investedValue);
        final returnsPercent =
            _parseAmount(data['totalPnlPercent']) ??
            (totalInvested > 0
                ? ((totalValue - totalInvested) / totalInvested) * 100
                : 0.0);

        if (!mounted) return;
        setState(() {
          _totalPortfolioValue = totalValue;
          _totalInvested = totalInvested;
          _returnsPercent = returnsPercent;
          _holdings = holdings;
          _isLoading = false;
        });
      } else {
        if (!mounted) return;
        setState(() {
          _errorMessage = 'The server returned an unexpected response.';
          _isLoading = false;
        });
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _errorMessage =
            'Your portfolio could not be loaded. Check your connection and try again.';
        _isLoading = false;
      });
    }
  }

  Future<void> _openBuyInvestment() async {
    await BuyInvestmentSheet.show(
      context,
      onCreated: (message) {
        if (!mounted) return;
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(message)));
        _fetchPortfolio();
      },
    );
  }

  /// Removing a holding is irreversible, so it always asks for explicit
  /// confirmation before calling `DELETE /investments/:id`.
  Future<void> _deleteHolding(InvestmentModel holding) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remove holding?'),
        content: Text(
          'Remove ${holding.symbol} from your portfolio? '
          'This deletes the entire holding, not just part of it.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    try {
      final res = await apiClient.delete(ApiEndpoints.investment(holding.id));
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            serverMessage(res.data) ?? '${holding.symbol} was removed.',
          ),
        ),
      );
      _fetchPortfolio();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            apiErrorMessage(error) ??
                'Holding could not be removed. Check your connection.',
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final isGain = _returnsPercent >= 0;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Investment Portfolio'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _fetchPortfolio,
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _openBuyInvestment,
        icon: const Icon(Icons.add_rounded),
        label: const Text('Buy'),
      ),
      body: _isLoading
          ? _buildSkeleton()
          : _errorMessage != null
          ? ErrorStateView(message: _errorMessage!, onRetry: _fetchPortfolio)
          : RefreshIndicator(
              onRefresh: _fetchPortfolio,
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    SummaryHeroCard(
                      label: 'Total Portfolio Value',
                      value: CurrencyFormatter.format(_totalPortfolioValue),
                      icon: Icons.pie_chart_rounded,
                      subtitle:
                          'Invested ${CurrencyFormatter.format(_totalInvested)}',
                      badge: StatusBadge(
                        label:
                            '${isGain ? "+" : ""}${_returnsPercent.toStringAsFixed(1)}% overall ${isGain ? "gain" : "change"}',
                        color: isGain ? AppColors.income : AppColors.expense,
                        icon: isGain
                            ? Icons.trending_up_rounded
                            : Icons.trending_down_rounded,
                      ),
                    ),
                    const SizedBox(height: 24),

                    Text(
                      'Holdings & Asset Breakdown',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary(isDark),
                      ),
                    ),
                    const SizedBox(height: 12),

                    if (_holdings.isEmpty)
                      EmptyStateView(
                        icon: Icons.show_chart_rounded,
                        title: 'No Investments Found',
                        description:
                            'Track mutual funds, equity holdings, and gold in one place.',
                      )
                    else
                      ..._holdings.map(
                        (h) => Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: _HoldingTile(
                            holding: h,
                            isDark: isDark,
                            onDelete: () => _deleteHolding(h),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildSkeleton() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
      children: [
        const SkeletonLoader(
          width: double.infinity,
          height: 186,
          borderRadius: 18,
        ),
        const SizedBox(height: 24),
        const SkeletonLoader(width: 190, height: 18),
        const SizedBox(height: 14),
        for (var i = 0; i < 3; i++) ...[
          FinancialCard(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: const [
                SkeletonLoader(width: 40, height: 40, borderRadius: 10),
                SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SkeletonLoader(width: 80, height: 14),
                      SizedBox(height: 8),
                      SkeletonLoader(width: 140, height: 11),
                    ],
                  ),
                ),
                SkeletonLoader(width: 64, height: 15),
              ],
            ),
          ),
          const SizedBox(height: 12),
        ],
      ],
    );
  }
}

double? _parseAmount(Object? value) {
  if (value is num) {
    final parsed = value.toDouble();
    return parsed.isFinite ? parsed : null;
  }
  if (value is String) {
    final parsed = double.tryParse(value.trim());
    return parsed != null && parsed.isFinite ? parsed : null;
  }
  return null;
}

class _HoldingTile extends StatelessWidget {
  final InvestmentModel holding;
  final bool isDark;
  final VoidCallback onDelete;

  const _HoldingTile({
    required this.holding,
    required this.isDark,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final isGold = holding.assetType == 'GOLD';
    final accent = isGold ? AppColors.gold : AppColors.primary;
    final isGain = holding.returnsPercent >= 0;

    return FinancialCard(
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: accent.withValues(alpha: 0.14),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(
              isGold
                  ? Icons.monetization_on_rounded
                  : Icons.candlestick_chart_rounded,
              size: 20,
              color: isGold ? AppColors.gold : AppColors.primaryLight,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  holding.symbol,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary(isDark),
                  ),
                ),
                Text(
                  holding.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12,
                    color: AppColors.textSecondary(isDark),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                CurrencyFormatter.format(holding.currentValue),
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary(isDark),
                ),
              ),
              Text(
                '${isGain ? "+" : ""}${holding.returnsPercent.toStringAsFixed(1)}%',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: isGain ? AppColors.income : AppColors.expense,
                ),
              ),
            ],
          ),
          PopupMenuButton<String>(
            tooltip: 'Holding options',
            padding: EdgeInsets.zero,
            onSelected: (value) {
              if (value == 'delete') onDelete();
            },
            itemBuilder: (_) => const [
              PopupMenuItem<String>(
                value: 'delete',
                child: Text('Remove holding'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
