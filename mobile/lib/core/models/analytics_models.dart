import 'model_parse.dart';

/// Models for the deterministic analytics endpoints.
///
/// Shapes mirror `node-backend/src/controllers/analyticsController.js` and
/// `node-backend/src/services/analyticsEngine.js` exactly:
///  * `GET /analytics`            → [AnalyticsModel]
///  * `GET /analytics/forecast`   → [ForecastModel]
///  * `GET /analytics/insights`   → [InsightModel] (list)
///
/// Only fields the backend actually emits are read. Percentages that the
/// backend reports as `null` when there is no comparable baseline (previous
/// period is zero) stay `null` here, so the UI can distinguish "no change
/// computable" from a real 0%.
double? analyticsDouble(Object? value) {
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

int? analyticsInt(Object? value) {
  if (value is int) return value;
  if (value is num) return value.isFinite ? value.toInt() : null;
  if (value is String) {
    final trimmed = value.trim();
    return int.tryParse(trimmed) ?? double.tryParse(trimmed)?.toInt();
  }
  return null;
}

String analyticsString(Object? value) => value is String ? value : '';

List<Map<String, dynamic>> _mapList(Object? value) {
  if (value is! List) return const [];
  return value
      .whereType<Map>()
      .map((entry) => Map<String, dynamic>.from(entry))
      .toList();
}

/// Header totals for the selected period (`data.summary`).
class AnalyticsSummary {
  final double totalIncome;
  final String formattedIncome;
  final double totalExpenses;
  final String formattedExpenses;
  final double netSavings;
  final String formattedNetSavings;

  /// Integer percent. The backend reports `0` when there is no income.
  final int savingsRate;
  final int incomeTransactions;
  final int expenseTransactions;

  AnalyticsSummary({
    required this.totalIncome,
    required this.formattedIncome,
    required this.totalExpenses,
    required this.formattedExpenses,
    required this.netSavings,
    required this.formattedNetSavings,
    required this.savingsRate,
    required this.incomeTransactions,
    required this.expenseTransactions,
  });

  factory AnalyticsSummary.fromJson(Map<String, dynamic> json) {
    const model = 'AnalyticsSummary';
    return AnalyticsSummary(
      totalIncome: parseRequiredDouble(json, 'totalIncome', model: model),
      formattedIncome: analyticsString(json['formattedIncome']),
      totalExpenses: parseRequiredDouble(json, 'totalExpenses', model: model),
      formattedExpenses: analyticsString(json['formattedExpenses']),
      netSavings: parseRequiredDouble(json, 'netSavings', model: model),
      formattedNetSavings: analyticsString(json['formattedNetSavings']),
      savingsRate: analyticsInt(json['savingsRate']) ?? 0,
      incomeTransactions: analyticsInt(json['incomeTransactions']) ?? 0,
      expenseTransactions: analyticsInt(json['expenseTransactions']) ?? 0,
    );
  }
}

/// One row of `data.categoryBreakdown` (expenses grouped by category).
class CategorySlice {
  final String category;
  final double amount;
  final String formattedAmount;

  /// Integer share of total expenses for the period.
  final int percentage;

  CategorySlice({
    required this.category,
    required this.amount,
    required this.formattedAmount,
    required this.percentage,
  });

  factory CategorySlice.fromJson(Map<String, dynamic> json) {
    const model = 'CategorySlice';
    return CategorySlice(
      category: analyticsString(json['category']).isNotEmpty
          ? json['category'] as String
          : 'Uncategorized',
      amount: parseRequiredDouble(json, 'amount', model: model),
      formattedAmount: analyticsString(json['formattedAmount']),
      percentage: analyticsInt(json['percentage']) ?? 0,
    );
  }
}

/// One point of `data.monthlyTrend` (`{date, amount}`).
class TrendPoint {
  final DateTime date;
  final double amount;

  TrendPoint({required this.date, required this.amount});

  factory TrendPoint.fromJson(Map<String, dynamic> json) {
    const model = 'TrendPoint';
    return TrendPoint(
      date: parseRequiredDate(json, 'date', model: model),
      amount: parseRequiredDouble(json, 'amount', model: model),
    );
  }
}

/// One point of `data.dailyFlow` (`{date, income, expenses, net}`).
class DailyFlowPoint {
  final DateTime date;
  final double income;
  final double expenses;
  final double net;

  DailyFlowPoint({
    required this.date,
    required this.income,
    required this.expenses,
    required this.net,
  });

  factory DailyFlowPoint.fromJson(Map<String, dynamic> json) {
    const model = 'DailyFlowPoint';
    return DailyFlowPoint(
      date: parseRequiredDate(json, 'date', model: model),
      income: parseRequiredDouble(json, 'income', model: model),
      expenses: parseRequiredDouble(json, 'expenses', model: model),
      net: parseRequiredDouble(json, 'net', model: model),
    );
  }
}

/// One metric comparison inside a month-over-month block.
class PeriodChange {
  final double previous;
  final double current;
  final double absoluteChange;

  /// `null` when there is no comparable baseline (previous period was zero).
  final double? percentageChange;

  /// `up` | `down` | `flat` — the backend's own classification.
  final String direction;

  PeriodChange({
    required this.previous,
    required this.current,
    required this.absoluteChange,
    required this.percentageChange,
    required this.direction,
  });

  factory PeriodChange.fromJson(Map<String, dynamic> json) {
    const model = 'PeriodChange';
    return PeriodChange(
      previous: parseRequiredDouble(json, 'previous', model: model),
      current: parseRequiredDouble(json, 'current', model: model),
      absoluteChange: parseRequiredDouble(json, 'absoluteChange', model: model),
      percentageChange: analyticsDouble(json['percentageChange']),
      direction: analyticsString(json['direction']).isNotEmpty
          ? json['direction'] as String
          : 'flat',
    );
  }
}

/// `data.monthOverMonth` — only present when a calendar month is in play.
class MonthOverMonth {
  final String comparisonPeriod;
  final PeriodChange incomeChange;
  final PeriodChange expenseChange;
  final PeriodChange netCashFlowChange;
  final PeriodChange savings;

  /// Percentage-point change in savings rate; `null` when either month had no
  /// income to compute a rate from.
  final double? savingsRateChange;

  MonthOverMonth({
    required this.comparisonPeriod,
    required this.incomeChange,
    required this.expenseChange,
    required this.netCashFlowChange,
    required this.savings,
    required this.savingsRateChange,
  });

  factory MonthOverMonth.fromJson(Map<String, dynamic> json) {
    PeriodChange change(String key) {
      final raw = json[key];
      if (raw is! Map) {
        throw ModelParseException('MonthOverMonth', key);
      }
      return PeriodChange.fromJson(Map<String, dynamic>.from(raw));
    }

    return MonthOverMonth(
      comparisonPeriod: analyticsString(json['comparisonPeriod']),
      incomeChange: change('incomeChange'),
      expenseChange: change('expenseChange'),
      netCashFlowChange: change('netCashFlowChange'),
      savings: change('savings'),
      savingsRateChange: analyticsDouble(json['savingsRateChange']),
    );
  }
}

/// The full `GET /analytics` payload.
class AnalyticsModel {
  final String period;
  final int? month;
  final int? year;
  final AnalyticsSummary summary;
  final MonthOverMonth? monthOverMonth;
  final List<CategorySlice> categoryBreakdown;
  final List<TrendPoint> monthlyTrend;
  final List<DailyFlowPoint> dailyFlow;

  AnalyticsModel({
    required this.period,
    this.month,
    this.year,
    required this.summary,
    this.monthOverMonth,
    required this.categoryBreakdown,
    required this.monthlyTrend,
    required this.dailyFlow,
  });

  /// True when the period contains at least one recorded movement. A real
  /// zero-activity period renders an empty state rather than a fake chart.
  bool get hasActivity =>
      summary.incomeTransactions > 0 ||
      summary.expenseTransactions > 0 ||
      dailyFlow.isNotEmpty ||
      categoryBreakdown.isNotEmpty;

  factory AnalyticsModel.fromJson(Map<String, dynamic> json) {
    const model = 'AnalyticsModel';
    final summary = json['summary'];
    if (summary is! Map) {
      throw const ModelParseException(model, 'summary');
    }
    final mom = json['monthOverMonth'];
    return AnalyticsModel(
      period: analyticsString(json['period']).isNotEmpty
          ? json['period'] as String
          : 'month',
      month: analyticsInt(json['month']),
      year: analyticsInt(json['year']),
      summary: AnalyticsSummary.fromJson(Map<String, dynamic>.from(summary)),
      monthOverMonth: mom is Map
          ? MonthOverMonth.fromJson(Map<String, dynamic>.from(mom))
          : null,
      categoryBreakdown: _mapList(json['categoryBreakdown'])
          .map(CategorySlice.fromJson)
          .toList(),
      monthlyTrend:
          _mapList(json['monthlyTrend']).map(TrendPoint.fromJson).toList(),
      dailyFlow:
          _mapList(json['dailyFlow']).map(DailyFlowPoint.fromJson).toList(),
    );
  }
}

/// One category row of the forecast (`data.categories[]`).
class ForecastCategory {
  final String category;
  final double spentSoFar;
  final String formattedSpentSoFar;
  final double projectedExpense;
  final String formattedProjectedExpense;
  final int transactionCount;

  ForecastCategory({
    required this.category,
    required this.spentSoFar,
    required this.formattedSpentSoFar,
    required this.projectedExpense,
    required this.formattedProjectedExpense,
    required this.transactionCount,
  });

  factory ForecastCategory.fromJson(Map<String, dynamic> json) {
    const model = 'ForecastCategory';
    return ForecastCategory(
      category: analyticsString(json['category']).isNotEmpty
          ? json['category'] as String
          : 'Uncategorized',
      spentSoFar: parseRequiredDouble(json, 'spentSoFar', model: model),
      formattedSpentSoFar: analyticsString(json['formattedSpentSoFar']),
      projectedExpense:
          parseRequiredDouble(json, 'projectedExpense', model: model),
      formattedProjectedExpense:
          analyticsString(json['formattedProjectedExpense']),
      transactionCount: analyticsInt(json['transactionCount']) ?? 0,
    );
  }
}

/// `GET /analytics/forecast` payload — an explicit estimate, never a fact.
class ForecastModel {
  final String method;
  final String methodLabel;
  final bool isEstimate;
  final String label;
  final bool insufficientData;
  final String? reason;
  final int month;
  final int year;
  final int daysInMonth;
  final int elapsedDays;
  final int remainingDays;
  final double spentSoFar;
  final String formattedSpentSoFar;
  final double averageDailySpend;
  final String formattedAverageDailySpend;

  /// `null` for a future month the backend cannot estimate from history.
  final double? projectedExpense;
  final String? formattedProjectedExpense;
  final int transactionCount;
  final int duplicatesExcluded;
  final bool isCompleteMonth;
  final List<ForecastCategory> categories;

  ForecastModel({
    required this.method,
    required this.methodLabel,
    required this.isEstimate,
    required this.label,
    required this.insufficientData,
    this.reason,
    required this.month,
    required this.year,
    required this.daysInMonth,
    required this.elapsedDays,
    required this.remainingDays,
    required this.spentSoFar,
    required this.formattedSpentSoFar,
    required this.averageDailySpend,
    required this.formattedAverageDailySpend,
    this.projectedExpense,
    this.formattedProjectedExpense,
    required this.transactionCount,
    required this.duplicatesExcluded,
    required this.isCompleteMonth,
    required this.categories,
  });

  factory ForecastModel.fromJson(Map<String, dynamic> json) {
    const model = 'ForecastModel';
    return ForecastModel(
      method: analyticsString(json['method']),
      methodLabel: analyticsString(json['methodLabel']),
      isEstimate: json['isEstimate'] == true,
      label: analyticsString(json['label']),
      insufficientData: json['insufficientData'] == true,
      reason: json['reason'] is String ? json['reason'] as String : null,
      month: analyticsInt(json['month']) ?? 0,
      year: analyticsInt(json['year']) ?? 0,
      daysInMonth: analyticsInt(json['daysInMonth']) ?? 0,
      elapsedDays: analyticsInt(json['elapsedDays']) ?? 0,
      remainingDays: analyticsInt(json['remainingDays']) ?? 0,
      spentSoFar: parseRequiredDouble(json, 'spentSoFar', model: model),
      formattedSpentSoFar: analyticsString(json['formattedSpentSoFar']),
      averageDailySpend:
          parseRequiredDouble(json, 'averageDailySpend', model: model),
      formattedAverageDailySpend:
          analyticsString(json['formattedAverageDailySpend']),
      projectedExpense: analyticsDouble(json['projectedExpense']),
      formattedProjectedExpense: json['formattedProjectedExpense'] is String
          ? json['formattedProjectedExpense'] as String
          : null,
      transactionCount: analyticsInt(json['transactionCount']) ?? 0,
      duplicatesExcluded: analyticsInt(json['duplicatesExcluded']) ?? 0,
      isCompleteMonth: json['isCompleteMonth'] == true,
      categories: _mapList(json['categories'])
          .map(ForecastCategory.fromJson)
          .toList(),
    );
  }
}

/// One entry of `GET /analytics/insights` → `data.insights[]`.
class InsightModel {
  final String type;

  /// `critical` | `warning` | `info`.
  final String severity;
  final String? category;
  final String title;
  final String explanation;

  /// True when the insight is a projection (forecast-derived), not a fact.
  final bool isEstimate;

  InsightModel({
    required this.type,
    required this.severity,
    this.category,
    required this.title,
    required this.explanation,
    required this.isEstimate,
  });

  factory InsightModel.fromJson(Map<String, dynamic> json) {
    const model = 'InsightModel';
    return InsightModel(
      type: parseRequiredString(json, 'type', model: model),
      severity: analyticsString(json['severity']).isNotEmpty
          ? json['severity'] as String
          : 'info',
      category: json['category'] is String ? json['category'] as String : null,
      title: parseRequiredString(json, 'title', model: model),
      explanation: analyticsString(json['explanation']),
      isEstimate: json['isEstimate'] == true,
    );
  }
}
