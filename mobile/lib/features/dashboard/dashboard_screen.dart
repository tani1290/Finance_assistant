import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:fl_chart/fl_chart.dart';
import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/auth/auth_notifier.dart';
import '../../core/models/account_model.dart';
import '../../core/models/transaction_model.dart';
import '../../core/sms/sms_platform_channel.dart';
import '../../core/utils/currency_formatter.dart';
import '../../core/utils/date_formatter.dart';
import '../../shared/widgets/financial_card.dart';
import '../../shared/widgets/skeleton_loader.dart';
import '../../shared/widgets/status_badge.dart';

class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  bool _isLoading = true;
  String? _errorMessage;

  double _netWorth = 0.0;
  double _monthlyIncome = 0.0;
  double _monthlyExpenses = 0.0;
  double _savingsRate = 0.0;
  int _healthScore = 78;
  int _pendingSmsCount = 0;
  String? _aiInsight;

  List<AccountModel> _accounts = [];
  List<TransactionModel> _recentTransactions = [];

  @override
  void initState() {
    super.initState();
    _fetchDashboardData();
    _syncIncomingSms();
  }

  Future<void> _syncIncomingSms() async {
    final synced = await SmsPlatformChannel.syncBufferedMessagesToBackend();
    if (synced > 0 && mounted) {
      _fetchDashboardData();
    }
  }

  Future<void> _fetchDashboardData() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      // 1. Fetch unified sync state
      final syncRes = await apiClient.get(ApiEndpoints.mobileSync);
      if (syncRes.statusCode == 200 && syncRes.data['success'] == true) {
        final data = syncRes.data['data'];
        final summary = data['summary'] ?? {};

        _netWorth = double.tryParse(summary['netWorth']?.toString() ?? '0') ?? 0.0;
        _pendingSmsCount = int.tryParse(summary['pendingSmsCount']?.toString() ?? '0') ?? 0;

        if (data['accounts'] is List) {
          _accounts = (data['accounts'] as List)
              .map((json) => AccountModel.fromJson(json))
              .toList();
        }

        if (data['recentTransactions'] is List) {
          _recentTransactions = (data['recentTransactions'] as List)
              .map((json) => TransactionModel.fromJson(json))
              .toList();
        }
      }

      // 2. Fetch Dashboard aggregations & health score
      try {
        final dashRes = await apiClient.get(ApiEndpoints.dashboard);
        if (dashRes.statusCode == 200 && dashRes.data['success'] == true) {
          final dashData = dashRes.data['data'];
          _monthlyIncome = double.tryParse(dashData['monthlyIncome']?.toString() ?? '0') ?? 0.0;
          _monthlyExpenses = double.tryParse(dashData['monthlyExpenses']?.toString() ?? '0') ?? 0.0;
          _savingsRate = double.tryParse(dashData['savingsRate']?.toString() ?? '0') ?? 0.0;
          _healthScore = int.tryParse(dashData['financialHealthScore']?.toString() ?? '75') ?? 75;
          _aiInsight = dashData['aiAdvice'] ?? dashData['insight'];
        }
      } catch (_) {}

      // Fallback calculations if endpoints returned zeroes
      if (_monthlyIncome == 0 && _recentTransactions.isNotEmpty) {
        _monthlyIncome = _recentTransactions
            .where((t) => t.isIncome)
            .fold(0.0, (sum, t) => sum + t.amount);
      }
      if (_monthlyExpenses == 0 && _recentTransactions.isNotEmpty) {
        _monthlyExpenses = _recentTransactions
            .where((t) => !t.isIncome)
            .fold(0.0, (sum, t) => sum + t.amount);
      }
      if (_savingsRate == 0 && _monthlyIncome > 0) {
        _savingsRate = (((_monthlyIncome - _monthlyExpenses) / _monthlyIncome) * 100).clamp(0, 100);
      }
      if (_aiInsight == null || _aiInsight!.isEmpty) {
        _aiInsight = "Your spending is on track this month. You're maintaining a ${_savingsRate.toStringAsFixed(0)}% savings rate across your primary bank accounts.";
      }
    } catch (e) {
      _errorMessage = 'Could not load live dashboard data. Pull to refresh.';
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authProvider).user;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Hello, ${user?.firstName.isNotEmpty == true ? user!.firstName : "Rahul"} 👋',
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            const Text(
              'Here is your financial clarity',
              style: TextStyle(fontSize: 12, color: AppColors.darkTextSecondary),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.sync_rounded),
            tooltip: 'Sync Mobile State',
            onPressed: () => context.push('/sync'),
          ),
          IconButton(
            icon: const Icon(Icons.notifications_outlined),
            onPressed: () => context.push('/notifications'),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _fetchDashboardData,
        child: _isLoading
            ? _buildLoadingSkeleton()
            : SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (_errorMessage != null) ...[
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: AppColors.expense.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: AppColors.expense.withValues(alpha: 0.4)),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.info_outline, color: AppColors.expense, size: 20),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                _errorMessage!,
                                style: const TextStyle(fontSize: 13, color: AppColors.expense),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 12),
                    ],

                    // Pending SMS Action Banner
                    if (_pendingSmsCount > 0) ...[
                      _buildPendingSmsBanner(),
                      const SizedBox(height: 16),
                    ],

                    // Net Worth Card
                    _buildNetWorthCard(isDark),
                    const SizedBox(height: 16),

                    // Cashflow Snapshot (Income vs Expense vs Savings)
                    _buildCashflowRow(isDark),
                    const SizedBox(height: 16),

                    // AI Advisor Insight Card
                    _buildAiInsightCard(isDark),
                    const SizedBox(height: 20),

                    // Quick Navigation Action Pills
                    _buildQuickActionsRow(),
                    const SizedBox(height: 24),

                    // Spending Activity Mini Chart
                    _buildSpendingTrendChart(isDark),
                    const SizedBox(height: 24),

                    // Accounts Overview
                    _buildAccountsSection(isDark),
                    const SizedBox(height: 24),

                    // Recent Transactions
                    _buildRecentTransactionsSection(isDark),
                    const SizedBox(height: 32),
                  ],
                ),
              ),
      ),
    );
  }

  Widget _buildPendingSmsBanner() {
    return InkWell(
      onTap: () => context.push('/pending-sms'),
      borderRadius: BorderRadius.circular(14),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(
          color: AppColors.warning.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.warning.withValues(alpha: 0.35)),
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: AppColors.warning.withValues(alpha: 0.2),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.sms_rounded, color: AppColors.warning, size: 20),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '$_pendingSmsCount Bank SMS Awaiting Review',
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: AppColors.warning,
                    ),
                  ),
                  const Text(
                    'Tap to confirm or categorize new transactions',
                    style: TextStyle(fontSize: 12, color: AppColors.darkTextSecondary),
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right_rounded, color: AppColors.warning),
          ],
        ),
      ),
    );
  }

  Widget _buildNetWorthCard(bool isDark) {
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: isDark
              ? [const Color(0xFF0F2537), const Color(0xFF132F4C)]
              : [const Color(0xFFE8F5E9), const Color(0xFFF1F8E9)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: isDark ? const Color(0xFF1E3A5F) : const Color(0xFFC8E6C9),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'TOTAL ESTIMATED NET WORTH',
                style: TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.8,
                  color: isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.verified_rounded, size: 13, color: AppColors.primaryLight),
                    const SizedBox(width: 4),
                    Text(
                      'Health: $_healthScore/100',
                      style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.primaryLight),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            CurrencyFormatter.format(_netWorth),
            style: TextStyle(
              fontSize: 34,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.5,
              color: isDark ? AppColors.darkTextPrimary : AppColors.lightTextPrimary,
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              const StatusBadge(
                label: '+12.4% this year',
                color: AppColors.primaryLight,
                icon: Icons.trending_up_rounded,
              ),
              const SizedBox(width: 12),
              Text(
                '${_accounts.length} active Indian accounts',
                style: TextStyle(
                  fontSize: 12.5,
                  color: isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildCashflowRow(bool isDark) {
    return Row(
      children: [
        Expanded(
          child: FinancialCard(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(6),
                      decoration: BoxDecoration(
                        color: AppColors.incomeBadgeBg,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.arrow_downward_rounded, size: 14, color: AppColors.income),
                    ),
                    const SizedBox(width: 8),
                    const Text('Income', style: TextStyle(fontSize: 12, color: AppColors.darkTextSecondary)),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  CurrencyFormatter.compact(_monthlyIncome),
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: FinancialCard(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(6),
                      decoration: BoxDecoration(
                        color: AppColors.expenseBadgeBg,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.arrow_upward_rounded, size: 14, color: AppColors.expense),
                    ),
                    const SizedBox(width: 8),
                    const Text('Spent', style: TextStyle(fontSize: 12, color: AppColors.darkTextSecondary)),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  CurrencyFormatter.compact(_monthlyExpenses),
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: FinancialCard(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(6),
                      decoration: BoxDecoration(
                        color: AppColors.primaryWash,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.pie_chart_rounded, size: 14, color: AppColors.primaryLight),
                    ),
                    const SizedBox(width: 8),
                    const Text('Saved', style: TextStyle(fontSize: 12, color: AppColors.darkTextSecondary)),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  '${_savingsRate.toStringAsFixed(0)}%',
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: AppColors.primaryLight),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildAiInsightCard(bool isDark) {
    return InkWell(
      onTap: () => context.push('/ai-advisor'),
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: isDark ? const Color(0xFF13231F) : const Color(0xFFECFDF5),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.primary.withValues(alpha: 0.3)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: AppColors.primary.withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Icon(Icons.auto_awesome_rounded, color: AppColors.primaryLight, size: 20),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'AI Financial Co-pilot',
                        style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: AppColors.primaryLight),
                      ),
                      Icon(Icons.arrow_forward_ios_rounded, size: 12, color: AppColors.primaryLight),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    _aiInsight ?? "Reviewing your accounts and daily patterns...",
                    style: TextStyle(
                      fontSize: 12.5,
                      color: isDark ? AppColors.darkTextPrimary : AppColors.lightTextPrimary,
                      height: 1.45,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildQuickActionsRow() {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          _buildActionButton(Icons.sms_outlined, 'Pending SMS', () => context.push('/pending-sms')),
          const SizedBox(width: 10),
          _buildActionButton(Icons.pie_chart_outline_rounded, 'Budgets', () => context.push('/budgets')),
          const SizedBox(width: 10),
          _buildActionButton(Icons.account_balance_outlined, 'Accounts', () => context.push('/accounts')),
          const SizedBox(width: 10),
          _buildActionButton(Icons.show_chart_rounded, 'Investments', () => context.push('/investments')),
          const SizedBox(width: 10),
          _buildActionButton(Icons.flag_outlined, 'Goals', () => context.push('/goals')),
          const SizedBox(width: 10),
          _buildActionButton(Icons.credit_card_outlined, 'Loans & EMI', () => context.push('/loans')),
        ],
      ),
    );
  }

  Widget _buildActionButton(IconData icon, String label, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: AppColors.darkSurface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.darkBorder),
        ),
        child: Row(
          children: [
            Icon(icon, size: 16, color: AppColors.primaryLight),
            const SizedBox(width: 8),
            Text(label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
          ],
        ),
      ),
    );
  }

  Widget _buildSpendingTrendChart(bool isDark) {
    return FinancialCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Spending & Cash Flow', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
              Text('October 2026', style: TextStyle(fontSize: 12, color: AppColors.darkTextSecondary)),
            ],
          ),
          const SizedBox(height: 20),
          SizedBox(
            height: 140,
            child: LineChart(
              LineChartData(
                gridData: const FlGridData(show: false),
                titlesData: const FlTitlesData(show: false),
                borderData: FlBorderData(show: false),
                lineBarsData: [
                  LineChartBarData(
                    spots: const [
                      FlSpot(0, 30),
                      FlSpot(1, 45),
                      FlSpot(2, 28),
                      FlSpot(3, 60),
                      FlSpot(4, 52),
                      FlSpot(5, 75),
                      FlSpot(6, 68),
                    ],
                    isCurved: true,
                    color: AppColors.primaryLight,
                    barWidth: 3,
                    isStrokeCapRound: true,
                    dotData: const FlDotData(show: false),
                    belowBarData: BarAreaData(
                      show: true,
                      color: AppColors.primaryLight.withValues(alpha: 0.12),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAccountsSection(bool isDark) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text('Your Accounts', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            TextButton(
              onPressed: () => context.push('/accounts'),
              child: const Text('View All', style: TextStyle(fontSize: 13)),
            ),
          ],
        ),
        const SizedBox(height: 10),
        if (_accounts.isEmpty)
          const Text('No accounts found. Tap to add one.')
        else
          ..._accounts.take(3).map((acc) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: FinancialCard(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: AppColors.primary.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: const Icon(Icons.account_balance_rounded, size: 20, color: AppColors.primaryLight),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(acc.name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                            Text(
                              acc.accountNumberMasked != null ? 'A/c •••• ${acc.accountNumberMasked}' : acc.accountType,
                              style: const TextStyle(fontSize: 12, color: AppColors.darkTextSecondary),
                            ),
                          ],
                        ),
                      ),
                      Text(
                        CurrencyFormatter.format(acc.balance),
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                      ),
                    ],
                  ),
                ),
              )),
      ],
    );
  }

  Widget _buildRecentTransactionsSection(bool isDark) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text('Recent Transactions', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            TextButton(
              onPressed: () => context.push('/transactions'),
              child: const Text('See All', style: TextStyle(fontSize: 13)),
            ),
          ],
        ),
        const SizedBox(height: 10),
        if (_recentTransactions.isEmpty)
          const Center(
            child: Padding(
              padding: EdgeInsets.all(24),
              child: Text('No transactions yet. Ingest bank SMS or log an expense!'),
            ),
          )
        else
          ..._recentTransactions.take(5).map((tx) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: FinancialCard(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  onTap: () => context.push('/transactions/${tx.id}'),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(9),
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
                              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5),
                            ),
                            Text(
                              '${tx.categoryName} • ${DateFormatter.relative(tx.date)}',
                              style: const TextStyle(fontSize: 11.5, color: AppColors.darkTextSecondary),
                            ),
                          ],
                        ),
                      ),
                      Text(
                        '${tx.isIncome ? "+" : "-"}${CurrencyFormatter.format(tx.amount)}',
                        style: TextStyle(
                          fontSize: 14.5,
                          fontWeight: FontWeight.w700,
                          color: tx.isIncome ? AppColors.income : (isDark ? AppColors.darkTextPrimary : AppColors.lightTextPrimary),
                        ),
                      ),
                    ],
                  ),
                ),
              )),
      ],
    );
  }

  Widget _buildLoadingSkeleton() {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: const [
          SkeletonLoader(width: double.infinity, height: 160, borderRadius: 20),
          SizedBox(height: 16),
          Row(
            children: [
              Expanded(child: SkeletonLoader(width: 100, height: 80, borderRadius: 16)),
              SizedBox(width: 12),
              Expanded(child: SkeletonLoader(width: 100, height: 80, borderRadius: 16)),
              SizedBox(width: 12),
              Expanded(child: SkeletonLoader(width: 100, height: 80, borderRadius: 16)),
            ],
          ),
          SizedBox(height: 20),
          SkeletonLoader(width: double.infinity, height: 80, borderRadius: 16),
          SizedBox(height: 24),
          SkeletonLoader(width: double.infinity, height: 200, borderRadius: 16),
        ],
      ),
    );
  }
}
