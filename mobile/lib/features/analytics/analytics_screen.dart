import 'dart:math' as math;

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/api/api_error.dart';
import '../../core/models/analytics_models.dart';
import '../../core/utils/currency_formatter.dart';
import '../../core/utils/date_formatter.dart';
import '../../shared/widgets/empty_state_view.dart';
import '../../shared/widgets/error_state_view.dart';
import '../../shared/widgets/financial_card.dart';
import '../../shared/widgets/section_header.dart';
import '../../shared/widgets/skeleton_loader.dart';
import '../../shared/widgets/summary_hero_card.dart';

/// The reporting period the screen is querying.
enum AnalyticsPeriod {
  month('Month', 'month'),
  week('Week', 'week'),
  year('Year', 'year');

  const AnalyticsPeriod(this.label, this.query);

  final String label;
  final String query;
}

/// Deterministic analytics built entirely from the verified backend endpoints:
/// `GET /analytics`, `GET /analytics/forecast`, `GET /analytics/insights`.
///
/// Nothing on this screen is synthesised. A period with no recorded activity
/// shows an explicit empty state, and forecast figures are always labelled as
/// estimates.
class AnalyticsScreen extends StatefulWidget {
  const AnalyticsScreen({super.key});

  @override
  State<AnalyticsScreen> createState() => _AnalyticsScreenState();
}

class _AnalyticsScreenState extends State<AnalyticsScreen> {
  AnalyticsPeriod _period = AnalyticsPeriod.month;
  late int _month;
  late int _year;

  bool _isLoading = true;
  String? _errorMessage;

  AnalyticsModel? _analytics;
  ForecastModel? _forecast;
  List<InsightModel> _insights = const [];

  /// Forecast/insights are secondary: their failure degrades gracefully and
  /// never blocks the primary summary. Failure is tracked per section so a
  /// failed request is never rendered as a genuine empty result, and a
  /// loading flag covers the window between the primary summary arriving and
  /// the secondary sections resolving.
  bool _secondaryLoading = false;
  bool _forecastFailed = false;
  bool _insightsFailed = false;

  /// Monotonic id of the newest primary request. A response is applied only
  /// while it still matches, so a slow earlier period can never overwrite a
  /// newer selection.
  int _requestId = 0;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _month = now.month;
    _year = now.year;
    _fetch();
  }

  Map<String, dynamic> _queryFor(AnalyticsPeriod period, int month, int year) =>
      period == AnalyticsPeriod.month
      ? {'month': month, 'year': year}
      : {'period': period.query};

  Future<void> _fetch() async {
    final requestId = ++_requestId;

    // Freeze the selection this request belongs to. Every later step reads
    // these values, never the mutable fields, so a response can never be
    // attributed to a period it was not fetched for.
    final period = _period;
    final month = _month;
    final year = _year;

    setState(() {
      _isLoading = true;
      _errorMessage = null;
      _forecast = null;
      _insights = const [];
      _secondaryLoading = false;
      _forecastFailed = false;
      _insightsFailed = false;
    });

    try {
      final res = await apiClient.get(
        ApiEndpoints.analytics,
        queryParameters: _queryFor(period, month, year),
      );

      if (!mounted || requestId != _requestId) return;

      if (res.statusCode == 200 &&
          res.data['success'] == true &&
          res.data['data'] is Map) {
        final model = AnalyticsModel.fromJson(
          Map<String, dynamic>.from(res.data['data'] as Map),
        );
        setState(() {
          _analytics = model;
          _isLoading = false;
          _secondaryLoading = period == AnalyticsPeriod.month;
        });
        await _fetchSecondary(
          requestId,
          period: period,
          month: month,
          year: year,
        );
      } else {
        setState(() {
          _errorMessage = 'The server returned an unexpected response.';
          _isLoading = false;
        });
      }
    } catch (error) {
      if (!mounted || requestId != _requestId) return;
      setState(() {
        _errorMessage =
            apiErrorMessage(error) ??
            'Your analytics could not be loaded. Check your connection and try again.';
        _isLoading = false;
      });
    }
  }

  Future<void> _fetchSecondary(
    int requestId, {
    required AnalyticsPeriod period,
    required int month,
    required int year,
  }) async {
    if (period != AnalyticsPeriod.month) {
      if (!mounted || requestId != _requestId) return;
      setState(() {
        _forecast = null;
        _insights = const [];
        _secondaryLoading = false;
        _forecastFailed = false;
        _insightsFailed = false;
      });
      return;
    }

    final query = {'month': month, 'year': year};
    ForecastModel? forecast;
    List<InsightModel> insights = const [];
    var forecastFailed = false;
    var insightsFailed = false;

    try {
      final res = await apiClient.get(
        ApiEndpoints.analyticsForecast,
        queryParameters: query,
      );
      if (res.statusCode == 200 &&
          res.data['success'] == true &&
          res.data['data'] is Map) {
        forecast = ForecastModel.fromJson(
          Map<String, dynamic>.from(res.data['data'] as Map),
        );
      } else {
        forecastFailed = true;
      }
    } catch (_) {
      forecastFailed = true;
    }

    // A newer selection may have replaced this request while the forecast was
    // in flight; drop the secondary result rather than attaching it to the
    // wrong summary.
    if (!mounted || requestId != _requestId) return;

    try {
      final res = await apiClient.get(
        ApiEndpoints.analyticsInsights,
        queryParameters: query,
      );
      if (res.statusCode == 200 &&
          res.data['success'] == true &&
          res.data['data'] is Map) {
        final raw = (res.data['data'] as Map)['insights'];
        if (raw is List) {
          insights = raw
              .whereType<Map>()
              .map(
                (entry) =>
                    InsightModel.fromJson(Map<String, dynamic>.from(entry)),
              )
              .toList();
        }
      } else {
        insightsFailed = true;
      }
    } catch (_) {
      insightsFailed = true;
    }

    if (!mounted || requestId != _requestId) return;
    setState(() {
      _forecast = forecast;
      _insights = insights;
      _secondaryLoading = false;
      _forecastFailed = forecastFailed;
      _insightsFailed = insightsFailed;
    });
  }

  /// Re-fetches only the secondary sections for the currently displayed month,
  /// leaving the valid primary summary untouched.
  Future<void> _retrySecondary() async {
    if (_period != AnalyticsPeriod.month) return;
    final requestId = _requestId;
    final month = _month;
    final year = _year;
    setState(() {
      _secondaryLoading = true;
      _forecastFailed = false;
      _insightsFailed = false;
    });
    await _fetchSecondary(
      requestId,
      period: AnalyticsPeriod.month,
      month: month,
      year: year,
    );
  }

  void _selectPeriod(AnalyticsPeriod period) {
    if (period == _period) return;
    HapticFeedback.selectionClick();
    setState(() => _period = period);
    _fetch();
  }

  void _shiftMonth(int delta) {
    var month = _month + delta;
    var year = _year;
    if (month < 1) {
      month = 12;
      year -= 1;
    } else if (month > 12) {
      month = 1;
      year += 1;
    }
    HapticFeedback.selectionClick();
    setState(() {
      _month = month;
      _year = year;
    });
    _fetch();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Financial Analytics'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _fetch,
          ),
        ],
      ),
      body: _isLoading
          ? _buildSkeleton()
          : _errorMessage != null
          ? ErrorStateView(message: _errorMessage!, onRetry: _fetch)
          : RefreshIndicator(
              onRefresh: _fetch,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
                children: [
                  _buildPeriodSelector(),
                  const SizedBox(height: 20),
                  ..._buildBody(isDark),
                ],
              ),
            ),
    );
  }

  Widget _buildPeriodSelector() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SegmentedButton<AnalyticsPeriod>(
          segments: [
            for (final period in AnalyticsPeriod.values)
              ButtonSegment(value: period, label: Text(period.label)),
          ],
          selected: {_period},
          showSelectedIcon: false,
          onSelectionChanged: (selection) => _selectPeriod(selection.first),
        ),
        if (_period == AnalyticsPeriod.month) ...[
          const SizedBox(height: 12),
          _buildMonthNavigator(),
        ],
      ],
    );
  }

  Widget _buildMonthNavigator() {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        IconButton(
          tooltip: 'Previous month',
          icon: const Icon(Icons.chevron_left_rounded),
          onPressed: () => _shiftMonth(-1),
        ),
        Expanded(
          child: Text(
            DateFormatter.formatMonthYear(DateTime(_year, _month)),
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary(isDark),
            ),
          ),
        ),
        IconButton(
          tooltip: 'Next month',
          icon: const Icon(Icons.chevron_right_rounded),
          onPressed: () => _shiftMonth(1),
        ),
      ],
    );
  }

  List<Widget> _buildBody(bool isDark) {
    final analytics = _analytics;
    if (analytics == null) {
      return [
        EmptyStateView(
          icon: Icons.insights_rounded,
          title: 'No data available',
          description: 'There is nothing to report for this period.',
          actionLabel: 'Retry',
          onAction: _fetch,
        ),
      ];
    }

    if (!analytics.hasActivity) {
      return [
        EmptyStateView(
          icon: Icons.insights_rounded,
          title: 'No activity in this period',
          description:
              'Once you record income or expenses, your analytics will appear here.',
          actionLabel: 'Refresh',
          onAction: _fetch,
        ),
      ];
    }

    final summary = analytics.summary;
    final widgets = <Widget>[
      SummaryHeroCard(
        label: 'Net Cash Flow',
        value: _money(summary.netSavings, summary.formattedNetSavings),
        subtitle:
            'Income ${_money(summary.totalIncome, summary.formattedIncome)}  •  '
            'Expenses ${_money(summary.totalExpenses, summary.formattedExpenses)}',
        icon: Icons.trending_up_rounded,
      ),
      const SizedBox(height: 16),
      _metricsRow(
        isDark,
        _metricCard(
          isDark: isDark,
          label: 'Income',
          value: _money(summary.totalIncome, summary.formattedIncome),
          caption:
              '${summary.incomeTransactions} ${summary.incomeTransactions == 1 ? "transaction" : "transactions"}',
          color: AppColors.income,
          icon: Icons.south_west_rounded,
        ),
        _metricCard(
          isDark: isDark,
          label: 'Expenses',
          value: _money(summary.totalExpenses, summary.formattedExpenses),
          caption:
              '${summary.expenseTransactions} ${summary.expenseTransactions == 1 ? "transaction" : "transactions"}',
          color: AppColors.expense,
          icon: Icons.north_east_rounded,
        ),
      ),
      const SizedBox(height: 16),
      _savingsCard(isDark, summary),
    ];

    final mom = analytics.monthOverMonth;
    if (mom != null) {
      widgets
        ..add(const SizedBox(height: 20))
        ..add(_monthOverMonthCard(isDark, mom));
    }

    widgets
      ..add(const SizedBox(height: 24))
      ..add(_buildTrend(isDark, analytics))
      ..add(const SizedBox(height: 24))
      ..add(_buildCategories(isDark, analytics));

    if (_period == AnalyticsPeriod.month) {
      widgets
        ..add(const SizedBox(height: 24))
        ..add(_buildForecast(isDark))
        ..add(const SizedBox(height: 24))
        ..add(_buildInsights(isDark));
    }

    return widgets;
  }

  Widget _buildSkeleton() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
      children: const [
        SkeletonLoader(width: double.infinity, height: 40, borderRadius: 12),
        SizedBox(height: 20),
        SkeletonLoader(width: double.infinity, height: 158, borderRadius: 18),
        SizedBox(height: 16),
        SkeletonLoader(width: double.infinity, height: 90, borderRadius: 18),
        SizedBox(height: 16),
        SkeletonLoader(width: double.infinity, height: 170, borderRadius: 18),
      ],
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Cards
  // ───────────────────────────────────────────────────────────────────────────

  Widget _metricsRow(bool isDark, Widget a, Widget b) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final scale = MediaQuery.textScalerOf(context).scale(1);
        final stack = constraints.maxWidth < 360 || scale > 1.3;
        if (stack) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [a, const SizedBox(height: 12), b],
          );
        }
        return IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(child: a),
              const SizedBox(width: 12),
              Expanded(child: b),
            ],
          ),
        );
      },
    );
  }

  Widget _metricCard({
    required bool isDark,
    required String label,
    required String value,
    required String caption,
    required Color color,
    required IconData icon,
  }) {
    return FinancialCard(
      padding: const EdgeInsets.all(16),
      accent: color,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 16, color: color),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  label,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textSecondary(isDark),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              value,
              maxLines: 1,
              style: TextStyle(
                fontSize: 19,
                fontWeight: FontWeight.w800,
                color: AppColors.textPrimary(isDark),
              ),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            caption,
            style: TextStyle(
              fontSize: 11.5,
              color: AppColors.textMuted(isDark),
            ),
          ),
        ],
      ),
    );
  }

  Widget _savingsCard(bool isDark, AnalyticsSummary summary) {
    final rate = summary.savingsRate;
    final color = rate >= 0 ? AppColors.income : AppColors.expense;

    return FinancialCard(
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Savings rate',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textSecondary(isDark),
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  summary.totalIncome > 0 ? '$rate%' : '—',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    color: summary.totalIncome > 0
                        ? color
                        : AppColors.textMuted(isDark),
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: Text(
              summary.totalIncome > 0
                  ? 'The share of income you kept this period.'
                  : 'Add income for this period to compute a savings rate.',
              style: TextStyle(
                fontSize: 12,
                height: 1.4,
                color: AppColors.textSecondary(isDark),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _monthOverMonthCard(bool isDark, MonthOverMonth mom) {
    return FinancialCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Month over month',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary(isDark),
                  ),
                ),
              ),
              Text(
                mom.comparisonPeriod,
                style: TextStyle(
                  fontSize: 11,
                  color: AppColors.textMuted(isDark),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          _changeRow(isDark, 'Expenses', mom.expenseChange, invert: true),
          const Divider(height: 22),
          _changeRow(isDark, 'Income', mom.incomeChange),
          const Divider(height: 22),
          _changeRow(isDark, 'Net cash flow', mom.netCashFlowChange),
          if (mom.savingsRateChange != null) ...[
            const Divider(height: 22),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Savings rate',
                    style: TextStyle(
                      fontSize: 13,
                      color: AppColors.textSecondary(isDark),
                    ),
                  ),
                ),
                Text(
                  '${mom.savingsRateChange! >= 0 ? '+' : ''}'
                  '${_trimPercent(mom.savingsRateChange!)} pp',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: mom.savingsRateChange! >= 0
                        ? AppColors.income
                        : AppColors.expense,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  /// A single metric comparison row.
  ///
  /// [invert] flips the colour logic: rising expenses are shown in red even
  /// though the raw change is positive.
  Widget _changeRow(
    bool isDark,
    String label,
    PeriodChange change, {
    bool invert = false,
  }) {
    final up = change.direction == 'up';
    final down = change.direction == 'down';
    final flat = !up && !down;

    Color color;
    IconData icon;
    if (flat) {
      color = AppColors.textMuted(isDark);
      icon = Icons.trending_flat_rounded;
    } else {
      final positive = invert ? down : up;
      color = positive ? AppColors.income : AppColors.expense;
      icon = up ? Icons.trending_up_rounded : Icons.trending_down_rounded;
    }

    final percent = change.percentageChange;
    final percentLabel = percent == null
        ? 'No prior baseline'
        : '${percent >= 0 ? '+' : ''}${_trimPercent(percent)}%';

    return Row(
      children: [
        Expanded(
          child: Text(
            label,
            style: TextStyle(
              fontSize: 13,
              color: AppColors.textSecondary(isDark),
            ),
          ),
        ),
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              // The amount is scaled down rather than allowed to overflow its
              // half of the row when the text scale is large.
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerRight,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(icon, size: 15, color: color),
                    const SizedBox(width: 4),
                    Text(
                      _money(change.current, null),
                      style: TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary(isDark),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 2),
              Text(
                percentLabel,
                style: TextStyle(fontSize: 11, color: color),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildTrend(bool isDark, AnalyticsModel analytics) {
    final points = analytics.dailyFlow;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader(title: 'Income vs. expenses'),
        FinancialCard(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildLegend(isDark),
              const SizedBox(height: 12),
              if (points.length < 2)
                SizedBox(
                  height: 120,
                  child: Center(
                    child: Text(
                      'Not enough daily activity in this period to chart a trend.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 12.5,
                        height: 1.4,
                        color: AppColors.textSecondary(isDark),
                      ),
                    ),
                  ),
                )
              else
                SizedBox(
                  height: 170,
                  child: LineChart(_trendData(isDark, points)),
                ),
              if (points.length >= 2) ...[
                const SizedBox(height: 8),
                Text(
                  '${DateFormatter.format(points.first.date)} – '
                  '${DateFormatter.format(points.last.date)}',
                  style: TextStyle(
                    fontSize: 11,
                    color: AppColors.textMuted(isDark),
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildLegend(bool isDark) {
    return Wrap(
      spacing: 16,
      runSpacing: 6,
      children: [
        _legendItem(isDark, AppColors.income, 'Income'),
        _legendItem(isDark, AppColors.expense, 'Expenses'),
      ],
    );
  }

  Widget _legendItem(bool isDark, Color color, String label) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 6),
        Text(
          label,
          style: TextStyle(
            fontSize: 12,
            color: AppColors.textSecondary(isDark),
          ),
        ),
      ],
    );
  }

  LineChartData _trendData(bool isDark, List<DailyFlowPoint> points) {
    final incomeSpots = <FlSpot>[
      for (var i = 0; i < points.length; i++)
        FlSpot(i.toDouble(), points[i].income),
    ];
    final expenseSpots = <FlSpot>[
      for (var i = 0; i < points.length; i++)
        FlSpot(i.toDouble(), points[i].expenses),
    ];

    var maxValue = 1.0;
    for (final point in points) {
      maxValue = math.max(maxValue, math.max(point.income, point.expenses));
    }
    final maxY = maxValue * 1.2;

    LineChartBarData bar(List<FlSpot> spots, Color color) {
      return LineChartBarData(
        spots: spots,
        isCurved: true,
        curveSmoothness: 0.3,
        color: color,
        barWidth: 2.5,
        isStrokeCapRound: true,
        dotData: FlDotData(show: spots.length <= 10),
        belowBarData: BarAreaData(
          show: true,
          color: color.withValues(alpha: 0.12),
        ),
      );
    }

    return LineChartData(
      gridData: FlGridData(
        show: true,
        drawVerticalLine: false,
        horizontalInterval: maxY / 4,
        getDrawingHorizontalLine: (value) => FlLine(
          color: AppColors.border(isDark).withValues(alpha: 0.6),
          strokeWidth: 1,
        ),
      ),
      titlesData: const FlTitlesData(show: false),
      borderData: FlBorderData(show: false),
      lineTouchData: const LineTouchData(enabled: false),
      minY: 0,
      maxY: maxY,
      minX: 0,
      maxX: (points.length - 1).toDouble(),
      lineBarsData: [
        bar(incomeSpots, AppColors.income),
        bar(expenseSpots, AppColors.expense),
      ],
    );
  }

  Widget _buildCategories(bool isDark, AnalyticsModel analytics) {
    final slices = analytics.categoryBreakdown;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader(title: 'Spending by category'),
        if (slices.isEmpty)
          FinancialCard(
            padding: const EdgeInsets.all(18),
            child: Text(
              'No categorised expenses in this period.',
              style: TextStyle(
                fontSize: 12.5,
                color: AppColors.textSecondary(isDark),
              ),
            ),
          )
        else
          FinancialCard(
            padding: const EdgeInsets.all(18),
            child: Column(
              children: [
                for (var i = 0; i < slices.length; i++) ...[
                  if (i > 0) const SizedBox(height: 16),
                  _categoryRow(isDark, slices[i]),
                ],
              ],
            ),
          ),
      ],
    );
  }

  Widget _categoryRow(bool isDark, CategorySlice slice) {
    final fraction = (slice.percentage.clamp(0, 100)) / 100.0;

    final categoryName = Text(
      slice.category,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: TextStyle(
        fontSize: 13.5,
        fontWeight: FontWeight.w600,
        color: AppColors.textPrimary(isDark),
      ),
    );
    final percentLabel = Text(
      '${slice.percentage}%',
      style: TextStyle(fontSize: 12, color: AppColors.textMuted(isDark)),
    );
    final amountLabel = Text(
      _money(slice.amount, slice.formattedAmount),
      style: TextStyle(
        fontSize: 13.5,
        fontWeight: FontWeight.w700,
        color: AppColors.textPrimary(isDark),
      ),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        LayoutBuilder(
          builder: (context, constraints) {
            final scale = MediaQuery.textScalerOf(context).scale(1);
            // On a narrow screen or with large text the category, percentage and
            // amount cannot share one line without overflowing, so the numbers
            // move to their own line (same rule as the summary metrics).
            if (constraints.maxWidth < 300 || scale > 1.3) {
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  categoryName,
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      percentLabel,
                      const Spacer(),
                      Flexible(
                        child: FittedBox(
                          fit: BoxFit.scaleDown,
                          alignment: Alignment.centerRight,
                          child: amountLabel,
                        ),
                      ),
                    ],
                  ),
                ],
              );
            }
            return Row(
              children: [
                Expanded(child: categoryName),
                const SizedBox(width: 8),
                percentLabel,
                const SizedBox(width: 8),
                amountLabel,
              ],
            );
          },
        ),
        const SizedBox(height: 6),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: fraction,
            minHeight: 6,
            backgroundColor: AppColors.border(isDark).withValues(alpha: 0.5),
            valueColor: const AlwaysStoppedAnimation<Color>(
              AppColors.primaryLight,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildForecast(bool isDark) {
    final forecast = _forecast;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader(title: 'Month-end forecast'),
        if (_secondaryLoading)
          _secondaryLoadingCard()
        else if (forecast == null)
          _forecastFailed
              ? _secondaryUnavailable(
                  isDark,
                  "Couldn't load the forecast for this month.",
                )
              : _secondaryEmpty(
                  isDark,
                  'No forecast is available for this month.',
                )
        else
          FinancialCard(
            padding: const EdgeInsets.all(18),
            accent: AppColors.warning,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Projected expenses',
                        style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textSecondary(isDark),
                        ),
                      ),
                    ),
                    if (forecast.isEstimate)
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 3,
                        ),
                        decoration: BoxDecoration(
                          color: AppColors.warning.withValues(alpha: 0.16),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: const Text(
                          'Estimate',
                          style: TextStyle(
                            fontSize: 10.5,
                            fontWeight: FontWeight.w700,
                            color: AppColors.warning,
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 8),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(
                    forecast.projectedExpense == null
                        ? '—'
                        : _money(
                            forecast.projectedExpense!,
                            forecast.formattedProjectedExpense,
                          ),
                    maxLines: 1,
                    style: TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.w800,
                      color: AppColors.textPrimary(isDark),
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  _forecastCaption(forecast),
                  style: TextStyle(
                    fontSize: 12,
                    height: 1.45,
                    color: AppColors.textSecondary(isDark),
                  ),
                ),
                if (forecast.duplicatesExcluded > 0) ...[
                  const SizedBox(height: 8),
                  Text(
                    '${forecast.duplicatesExcluded} duplicate '
                    '${forecast.duplicatesExcluded == 1 ? "entry was" : "entries were"} '
                    'excluded from this projection.',
                    style: TextStyle(
                      fontSize: 11,
                      color: AppColors.textMuted(isDark),
                    ),
                  ),
                ],
              ],
            ),
          ),
      ],
    );
  }

  String _forecastCaption(ForecastModel forecast) {
    if (forecast.insufficientData) {
      return 'Not enough spending recorded this month to project a total. '
          'This is not a guarantee.';
    }
    if (forecast.projectedExpense == null) {
      return 'A future month cannot be projected from history yet. '
          'This is not a guarantee.';
    }
    return 'Spent ${_money(forecast.spentSoFar, forecast.formattedSpentSoFar)} '
        'over ${forecast.elapsedDays} of ${forecast.daysInMonth} days '
        '(${_money(forecast.averageDailySpend, forecast.formattedAverageDailySpend)}/day, '
        'run-rate). This is an estimate, not a guarantee.';
  }

  Widget _buildInsights(bool isDark) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader(title: 'Insights'),
        if (_secondaryLoading)
          _secondaryLoadingCard()
        else if (_insights.isEmpty)
          _insightsFailed
              ? _secondaryUnavailable(
                  isDark,
                  "Couldn't load insights for this period.",
                )
              : _secondaryEmpty(isDark, 'No insights for this period.')
        else
          for (final insight in _insights) ...[
            _insightCard(isDark, insight),
            const SizedBox(height: 12),
          ],
      ],
    );
  }

  /// A quiet placeholder while the secondary sections are still loading, so a
  /// pending request is never shown as an empty result.
  Widget _secondaryLoadingCard() {
    return const FinancialCard(
      padding: EdgeInsets.all(18),
      child: SkeletonLoader(
        width: double.infinity,
        height: 44,
        borderRadius: 10,
      ),
    );
  }

  /// A genuine empty secondary section (the request succeeded but there was
  /// nothing to report).
  Widget _secondaryEmpty(bool isDark, String message) {
    return FinancialCard(
      padding: const EdgeInsets.all(18),
      child: Text(
        message,
        style: TextStyle(fontSize: 12.5, color: AppColors.textSecondary(isDark)),
      ),
    );
  }

  /// A small, theme-aware "unavailable" affordance shown when a secondary
  /// request failed. It is visually distinct from a genuine empty result and
  /// offers a retry that re-fetches only the secondary sections.
  Widget _secondaryUnavailable(bool isDark, String message) {
    return FinancialCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                Icons.cloud_off_rounded,
                size: 18,
                color: AppColors.textSecondary(isDark),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  message,
                  style: TextStyle(
                    fontSize: 12.5,
                    height: 1.4,
                    color: AppColors.textSecondary(isDark),
                  ),
                ),
              ),
            ],
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: _retrySecondary,
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                minimumSize: const Size(0, 32),
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                foregroundColor: AppColors.primaryLight,
              ),
              child: const Text('Retry'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _insightCard(bool isDark, InsightModel insight) {
    final (color, icon) = switch (insight.severity) {
      'critical' => (AppColors.expense, Icons.error_outline_rounded),
      'warning' => (AppColors.warning, Icons.warning_amber_rounded),
      _ => (AppColors.info, Icons.info_outline_rounded),
    };

    return FinancialCard(
      padding: const EdgeInsets.all(16),
      accent: color,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: color),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  insight.title,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary(isDark),
                  ),
                ),
                if (insight.explanation.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(
                    insight.explanation,
                    style: TextStyle(
                      fontSize: 12.5,
                      height: 1.4,
                      color: AppColors.textSecondary(isDark),
                    ),
                  ),
                ],
                if (insight.isEstimate) ...[
                  const SizedBox(height: 6),
                  Text(
                    'Projection — not a guarantee.',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: color,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────

  /// Prefers the server's own formatted string; falls back to local INR
  /// formatting of the real numeric value (never invented).
  String _money(double amount, String? formatted) {
    if (formatted != null && formatted.isNotEmpty) return formatted;
    return CurrencyFormatter.format(amount);
  }

  static String _trimPercent(double value) {
    if (value == value.roundToDouble()) return value.toStringAsFixed(0);
    return value.toStringAsFixed(1);
  }
}
