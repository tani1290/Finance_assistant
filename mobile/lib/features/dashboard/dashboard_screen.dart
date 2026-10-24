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
import '../../shared/widgets/financial_card.dart';
import '../../shared/widgets/error_state_view.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/section_header.dart';
import '../../shared/widgets/skeleton_loader.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/transaction_tile.dart';

class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  static const _months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  bool _isLoading = true;
  bool _hasLoaded = false;
  bool _analyticsFailed = false;
  bool _dashboardFailed = false;
  String? _errorMessage;

  double _netWorth = 0.0;
  double _monthlyIncome = 0.0;
  double _monthlyExpenses = 0.0;
  double _savingsRate = 0.0;
  int? _healthScore;
  int _pendingSmsCount = 0;
  String? _aiInsight;

  /// Real daily expense points for the current month. Empty until verified
  /// analytics data arrives; the UI never substitutes sample values.
  List<FlSpot> _expenseSpots = const [];
  double _expenseChartMaxY = 0.0;

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
      _analyticsFailed = false;
      _dashboardFailed = false;
      _expenseSpots = const [];
      _expenseChartMaxY = 0.0;
    });

    try {
      // 1. Fetch unified sync state
      final syncRes = await apiClient.get(ApiEndpoints.mobileSync);
      if (syncRes.statusCode == 200 && syncRes.data['success'] == true) {
        final data = syncRes.data['data'];
        final summary = data['summary'] ?? {};

        _netWorth =
            double.tryParse(summary['netWorth']?.toString() ?? '0') ?? 0.0;
        _monthlyIncome =
            double.tryParse(summary['monthlyIncome']?.toString() ?? '0') ?? 0.0;
        _monthlyExpenses =
            double.tryParse(summary['monthlyExpenses']?.toString() ?? '0') ??
            0.0;
        _savingsRate =
            double.tryParse(summary['savingsRate']?.toString() ?? '0') ?? 0.0;
        _pendingSmsCount =
            int.tryParse(summary['pendingSmsCount']?.toString() ?? '0') ?? 0;

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

        _hasLoaded = true;
      } else {
        _errorMessage = 'Could not load live dashboard data. Pull to refresh.';
      }

      // 2. Fetch Dashboard aggregations & health score
      try {
        final dashRes = await apiClient.get(ApiEndpoints.dashboard);
        if (dashRes.statusCode == 200 && dashRes.data['success'] == true) {
          final dashData = dashRes.data['data'];
          // Net worth is authoritative here: it folds in investments and loans,
          // not just cash balances, so it never under-reports portfolio value.
          _netWorth =
              double.tryParse(dashData['netWorth']?.toString() ?? '') ??
              _netWorth;
          _monthlyIncome =
              double.tryParse(dashData['monthlyIncome']?.toString() ?? '') ??
              _monthlyIncome;
          _monthlyExpenses =
              double.tryParse(dashData['monthlyExpenses']?.toString() ?? '') ??
              _monthlyExpenses;
          _savingsRate =
              double.tryParse(dashData['savingsRate']?.toString() ?? '') ??
              _savingsRate;
          _healthScore = int.tryParse(
            dashData['financialHealthScore']?.toString() ?? '',
          );
          final insight =
              dashData['aiAdvice'] ??
              dashData['insight'] ??
              dashData['planSummary'];
          _aiInsight = insight is String ? insight : null;
        } else {
          _dashboardFailed = true;
        }
      } catch (_) {
        _dashboardFailed = true;
      }

      // 3. Fetch the real current-month daily cash flow for the trend chart.
      try {
        final analyticsRes = await apiClient.get(ApiEndpoints.analytics);
        if (analyticsRes.statusCode == 200 &&
            analyticsRes.data['success'] == true) {
          final analyticsData = analyticsRes.data['data'];
          final dailyFlow = analyticsData is Map
              ? analyticsData['dailyFlow']
              : null;
          if (dailyFlow is List) {
            final spots = <FlSpot>[];
            var maxExpense = 0.0;
            for (final entry in dailyFlow) {
              if (entry is! Map) continue;
              final day = DateTime.tryParse(entry['date']?.toString() ?? '');
              final expense = double.tryParse(
                entry['expenses']?.toString() ?? '',
              );
              if (day == null || expense == null) continue;
              if (expense > maxExpense) maxExpense = expense;
              spots.add(FlSpot(day.day.toDouble(), expense));
            }
            spots.sort((a, b) => a.x.compareTo(b.x));
            _expenseSpots = spots;
            _expenseChartMaxY = maxExpense;
          }
        } else {
          _analyticsFailed = true;
        }
      } catch (_) {
        _analyticsFailed = true;
      }

      // Do not infer monthly income/expenses from the recent-transactions
      // preview: it is a truncated list and would under-report the month.
      // Zeroes are shown honestly when the backend has no data yet.
      if (_savingsRate == 0 && _monthlyIncome > 0) {
        _savingsRate =
            (((_monthlyIncome - _monthlyExpenses) / _monthlyIncome) * 100)
                .clamp(0, 100);
      }
    } catch (_) {
      _errorMessage = 'Could not load live dashboard data. Pull to refresh.';
      _dashboardFailed = true;
      _analyticsFailed = true;
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
    final name = user?.firstName.isNotEmpty == true ? user!.firstName : 'there';

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Hi, $name 👋',
              style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700),
            ),
            Text(
              'Here is your financial clarity',
              style: TextStyle(
                fontSize: 12,
                color: AppColors.textSecondary(isDark),
              ),
            ),
          ],
        ),
        actions: [
          _CircleIconButton(
            icon: Icons.sync_rounded,
            tooltip: 'Sync',
            onTap: () => context.push('/sync'),
          ),
          const SizedBox(width: 4),
          _CircleIconButton(
            icon: Icons.notifications_none_rounded,
            tooltip: 'Notifications',
            showDot: _pendingSmsCount > 0,
            onTap: () => context.push('/notifications'),
          ),
          const SizedBox(width: 12),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _fetchDashboardData,
        child: _isLoading
            ? SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                child: _buildLoadingSkeleton(),
              )
            : _errorMessage != null && !_hasLoaded
            ? ErrorStateView(
                message: _errorMessage!,
                onRetry: _fetchDashboardData,
              )
            : SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (_errorMessage != null) ...[
                      _buildErrorBanner(isDark),
                      const SizedBox(height: 12),
                    ],

                    // Pending SMS Action Banner
                    if (_pendingSmsCount > 0) ...[
                      _buildPendingSmsBanner(isDark),
                      const SizedBox(height: 16),
                    ],

                    // Net Worth Card
                    _buildNetWorthCard(isDark),
                    const SizedBox(height: 16),

                    // Cashflow Snapshot
                    _buildCashflowRow(isDark),
                    const SizedBox(height: 20),

                    // AI Advisor Insight Card
                    _buildAiInsightCard(isDark),
                    const SizedBox(height: 24),

                    // Quick Navigation Action Pills
                    _buildQuickActionsRow(isDark),
                    const SizedBox(height: 24),

                    // Spending Activity Mini Chart
                    _buildSpendingTrendChart(isDark),
                    const SizedBox(height: 24),

                    // Accounts Overview
                    _buildAccountsSection(isDark),
                    const SizedBox(height: 24),

                    // Recent Transactions
                    _buildRecentTransactionsSection(isDark),
                  ],
                ),
              ),
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Widgets
  // ─────────────────────────────────────────────────────────────

  Widget _buildErrorBanner(bool isDark) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.expense.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.expense.withValues(alpha: 0.35)),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.info_outline_rounded,
            color: AppColors.expense,
            size: 20,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              _errorMessage!,
              style: const TextStyle(fontSize: 13, color: AppColors.expense),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPendingSmsBanner(bool isDark) {
    return Pressable(
      onTap: () => context.push('/pending-sms'),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: AppColors.warning.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.warning.withValues(alpha: 0.32)),
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(9),
              decoration: BoxDecoration(
                color: AppColors.warning.withValues(alpha: 0.2),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.sms_rounded,
                color: AppColors.warning,
                size: 20,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '$_pendingSmsCount bank SMS to review',
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: AppColors.warning,
                    ),
                  ),
                  Text(
                    'Tap to confirm or categorise new transactions',
                    style: TextStyle(
                      fontSize: 12,
                      color: AppColors.textSecondary(isDark),
                    ),
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
    final textPrimary = AppColors.textPrimary(isDark);
    final textSecondary = AppColors.textSecondary(isDark);

    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: isDark
              ? AppColors.heroGradientDark
              : AppColors.heroGradientLight,
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: isDark
              ? AppColors.primary.withValues(alpha: 0.28)
              : AppColors.primary.withValues(alpha: 0.20),
        ),
        boxShadow: AppColors.shadow(isDark),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'TOTAL NET WORTH',
                style: TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1.0,
                  color: textSecondary,
                ),
              ),
              if (_healthScore != null)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 9,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.primary.withValues(alpha: 0.16),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.favorite_rounded,
                        size: 12,
                        color: AppColors.primaryLight,
                      ),
                      const SizedBox(width: 5),
                      Text(
                        '${_healthScore!}',
                        style: const TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w700,
                          color: AppColors.primaryLight,
                        ),
                      ),
                      Text(
                        '/100',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w600,
                          color: textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            CurrencyFormatter.format(_netWorth),
            style: TextStyle(
              fontSize: 36,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.8,
              color: textPrimary,
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              if (_monthlyIncome > 0) ...[
                StatusBadge(
                  label: '${_savingsRate.toStringAsFixed(0)}% savings rate',
                  color: _savingsRate >= 0
                      ? AppColors.primaryLight
                      : AppColors.expense,
                  icon: _savingsRate >= 0
                      ? Icons.trending_up_rounded
                      : Icons.trending_down_rounded,
                ),
                const SizedBox(width: 12),
              ],
              Flexible(
                child: Text(
                  '${_accounts.length} linked ${_accounts.length == 1 ? "account" : "accounts"}',
                  style: TextStyle(fontSize: 12.5, color: textSecondary),
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
          child: _buildMetricCard(
            isDark: isDark,
            icon: Icons.arrow_downward_rounded,
            iconColor: AppColors.income,
            iconBg: AppColors.incomeBadgeBg,
            label: 'Income',
            value: CurrencyFormatter.compact(_monthlyIncome),
            valueColor: AppColors.textPrimary(isDark),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _buildMetricCard(
            isDark: isDark,
            icon: Icons.arrow_upward_rounded,
            iconColor: AppColors.expense,
            iconBg: AppColors.expenseBadgeBg,
            label: 'Spent',
            value: CurrencyFormatter.compact(_monthlyExpenses),
            valueColor: AppColors.textPrimary(isDark),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _buildMetricCard(
            isDark: isDark,
            icon: Icons.savings_rounded,
            iconColor: AppColors.primaryLight,
            iconBg: AppColors.primaryWash,
            label: 'Saved',
            value: _monthlyIncome > 0
                ? '${_savingsRate.toStringAsFixed(0)}%'
                : '—',
            valueColor: AppColors.primaryLight,
          ),
        ),
      ],
    );
  }

  Widget _buildMetricCard({
    required bool isDark,
    required IconData icon,
    required Color iconColor,
    required Color iconBg,
    required String label,
    required String value,
    required Color valueColor,
  }) {
    return FinancialCard(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(color: iconBg, shape: BoxShape.circle),
            child: Icon(icon, size: 14, color: iconColor),
          ),
          const SizedBox(height: 10),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              color: AppColors.textSecondary(isDark),
            ),
          ),
          const SizedBox(height: 2),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              value,
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w700,
                color: valueColor,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAiInsightCard(bool isDark) {
    final insight = (_aiInsight != null && _aiInsight!.trim().isNotEmpty)
        ? _aiInsight!.trim()
        : _dashboardFailed
        ? 'Your financial insight could not be loaded. Pull to refresh to try again.'
        : 'No AI insight available yet. Add transactions or connect an account to get personalised guidance.';

    return Pressable(
      onTap: () => context.push('/ai-advisor'),
      child: Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: isDark
                ? [const Color(0xFF10241F), const Color(0xFF0E1D2A)]
                : [const Color(0xFFE9FBF3), const Color(0xFFEFF6FF)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: AppColors.primary.withValues(alpha: 0.28)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(9),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: AppColors.primaryGradient,
                ),
                borderRadius: BorderRadius.circular(11),
              ),
              child: const Icon(
                Icons.auto_awesome_rounded,
                color: Colors.white,
                size: 20,
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'AI Financial Co-pilot',
                        style: TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w700,
                          color: AppColors.primaryLight,
                        ),
                      ),
                      Icon(
                        Icons.arrow_forward_ios_rounded,
                        size: 12,
                        color: isDark
                            ? AppColors.primaryLight
                            : AppColors.primary,
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    insight,
                    style: TextStyle(
                      fontSize: 12.5,
                      color: AppColors.textPrimary(isDark),
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

  Widget _buildQuickActionsRow(bool isDark) {
    final actions = <_QuickAction>[
      _QuickAction(
        Icons.insights_rounded,
        'Analytics',
        () => context.push('/analytics'),
      ),
      _QuickAction(
        Icons.sms_outlined,
        'SMS Inbox',
        () => context.push('/pending-sms'),
      ),
      _QuickAction(
        Icons.pie_chart_outline_rounded,
        'Budgets',
        () => context.push('/budgets'),
      ),
      _QuickAction(
        Icons.account_balance_outlined,
        'Accounts',
        () => context.push('/accounts'),
      ),
      _QuickAction(
        Icons.show_chart_rounded,
        'Invest',
        () => context.push('/investments'),
      ),
      _QuickAction(Icons.flag_outlined, 'Goals', () => context.push('/goals')),
      _QuickAction(
        Icons.credit_card_outlined,
        'Loans',
        () => context.push('/loans'),
      ),
    ];

    return SizedBox(
      height: 84,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: actions.length,
        separatorBuilder: (_, _) => const SizedBox(width: 12),
        itemBuilder: (context, i) {
          final a = actions[i];
          return Pressable(
            onTap: a.onTap,
            child: Container(
              width: 72,
              padding: const EdgeInsets.symmetric(vertical: 12),
              decoration: BoxDecoration(
                color: AppColors.surface(isDark),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: AppColors.border(isDark)),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(a.icon, size: 22, color: AppColors.primaryLight),
                  const SizedBox(height: 8),
                  Text(
                    a.label,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textPrimary(isDark),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildSpendingTrendChart(bool isDark) {
    final now = DateTime.now();
    final monthLabel = '${_months[now.month - 1]} ${now.year}';
    // A single point is not a trend; show an honest empty state instead.
    final hasTrend = _expenseSpots.length >= 2 && _expenseChartMaxY > 0;
    final maxY = hasTrend ? _expenseChartMaxY * 1.2 : 100.0;

    return FinancialCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Spending & Cash Flow',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: AppColors.surfaceSubtle(isDark),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  monthLabel,
                  style: TextStyle(
                    fontSize: 11.5,
                    color: AppColors.textSecondary(isDark),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          if (!hasTrend)
            Container(
              height: 120,
              alignment: Alignment.center,
              child: Text(
                _analyticsFailed
                    ? 'The spending trend could not be loaded. Pull to refresh.'
                    : 'Not enough activity this month to chart a spending trend.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 12.5,
                  color: AppColors.textSecondary(isDark),
                  height: 1.4,
                ),
              ),
            )
          else
            SizedBox(
              height: 150,
              child: LineChart(
                LineChartData(
                  gridData: FlGridData(
                    show: true,
                    drawVerticalLine: false,
                    horizontalInterval: maxY / 4,
                    getDrawingHorizontalLine: (v) => FlLine(
                      color: AppColors.border(isDark).withValues(alpha: 0.6),
                      strokeWidth: 1,
                    ),
                  ),
                  titlesData: const FlTitlesData(show: false),
                  borderData: FlBorderData(show: false),
                  lineTouchData: const LineTouchData(enabled: false),
                  minY: 0,
                  maxY: maxY,
                  minX: _expenseSpots.first.x,
                  maxX: _expenseSpots.last.x,
                  lineBarsData: [
                    LineChartBarData(
                      spots: _expenseSpots,
                      isCurved: true,
                      curveSmoothness: 0.35,
                      gradient: const LinearGradient(
                        colors: [AppColors.primaryLight, AppColors.teal],
                      ),
                      barWidth: 3,
                      isStrokeCapRound: true,
                      dotData: FlDotData(
                        show: _expenseSpots.length <= 10,
                        getDotPainter: (spot, percent, bar, index) =>
                            FlDotCirclePainter(
                              radius: 3,
                              color: AppColors.primaryLight,
                              strokeWidth: 2,
                              strokeColor: AppColors.surface(isDark),
                            ),
                      ),
                      belowBarData: BarAreaData(
                        show: true,
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          colors: [
                            AppColors.primaryLight.withValues(alpha: 0.28),
                            AppColors.primaryLight.withValues(alpha: 0.0),
                          ],
                        ),
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
        SectionHeader(
          title: 'Your Accounts',
          subtitle: '${_accounts.length} linked',
          actionLabel: 'View all',
          onAction: () => context.push('/accounts'),
        ),
        if (_accounts.isEmpty)
          FinancialCard(
            padding: const EdgeInsets.symmetric(vertical: 28),
            child: Center(
              child: Text(
                'No accounts yet — add one to get started.',
                style: TextStyle(
                  fontSize: 13,
                  color: AppColors.textSecondary(isDark),
                ),
              ),
            ),
          )
        else
          ..._accounts
              .take(3)
              .map(
                (acc) => Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: FinancialCard(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 14,
                    ),
                    onTap: () => context.push('/accounts'),
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: AppColors.primary.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: const Icon(
                            Icons.account_balance_rounded,
                            size: 20,
                            color: AppColors.primaryLight,
                          ),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                acc.name,
                                style: TextStyle(
                                  fontWeight: FontWeight.w600,
                                  fontSize: 14,
                                  color: AppColors.textPrimary(isDark),
                                ),
                              ),
                              Text(
                                acc.accountNumberMasked != null &&
                                        acc.accountNumberMasked!.isNotEmpty
                                    ? '${acc.accountTypeLabel} • •••• ${acc.accountNumberMasked}'
                                    : acc.accountTypeLabel,
                                style: TextStyle(
                                  fontSize: 12,
                                  color: AppColors.textSecondary(isDark),
                                ),
                              ),
                            ],
                          ),
                        ),
                        Text(
                          CurrencyFormatter.format(acc.balance),
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 15,
                            color: AppColors.textPrimary(isDark),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
      ],
    );
  }

  Widget _buildRecentTransactionsSection(bool isDark) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(
          title: 'Recent Activity',
          actionLabel: 'See all',
          onAction: () => context.push('/transactions'),
        ),
        if (_recentTransactions.isEmpty)
          FinancialCard(
            padding: const EdgeInsets.symmetric(vertical: 28),
            child: Center(
              child: Text(
                'No transactions yet. Bank SMS will appear here automatically.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 13,
                  color: AppColors.textSecondary(isDark),
                ),
              ),
            ),
          )
        else
          ..._recentTransactions
              .take(5)
              .map(
                (tx) => Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: TransactionTile(
                    tx: tx,
                    onTap: () => context.push('/transactions/${tx.id}'),
                  ),
                ),
              ),
      ],
    );
  }

  Widget _buildLoadingSkeleton() {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: const [
          SkeletonLoader(width: double.infinity, height: 170, borderRadius: 24),
          SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: SkeletonLoader(width: 100, height: 92, borderRadius: 18),
              ),
              SizedBox(width: 12),
              Expanded(
                child: SkeletonLoader(width: 100, height: 92, borderRadius: 18),
              ),
              SizedBox(width: 12),
              Expanded(
                child: SkeletonLoader(width: 100, height: 92, borderRadius: 18),
              ),
            ],
          ),
          SizedBox(height: 20),
          SkeletonLoader(width: double.infinity, height: 84, borderRadius: 18),
          SizedBox(height: 24),
          SkeletonLoader(width: double.infinity, height: 220, borderRadius: 18),
        ],
      ),
    );
  }
}

class _QuickAction {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  const _QuickAction(this.icon, this.label, this.onTap);
}

class _CircleIconButton extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;
  final bool showDot;

  const _CircleIconButton({
    required this.icon,
    required this.tooltip,
    required this.onTap,
    this.showDot = false,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Stack(
      clipBehavior: Clip.none,
      children: [
        IconButton(
          tooltip: tooltip,
          onPressed: onTap,
          icon: Icon(icon, size: 22),
          style: IconButton.styleFrom(
            backgroundColor: AppColors.surfaceSubtle(isDark),
            shape: const CircleBorder(),
          ),
        ),
        if (showDot)
          Positioned(
            right: 9,
            top: 9,
            child: Container(
              width: 9,
              height: 9,
              decoration: BoxDecoration(
                color: AppColors.expense,
                shape: BoxShape.circle,
                border: Border.all(color: AppColors.bg(isDark), width: 1.5),
              ),
            ),
          ),
      ],
    );
  }
}
