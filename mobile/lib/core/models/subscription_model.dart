import 'model_parse.dart';

/// A recurring subscription as returned by `GET /subscriptions`.
///
/// [monthlyCost] normalises the billing cycle with the same rules the backend
/// uses for its summary, so the monthly total is always recomputed from the
/// authoritative list rather than trusted as a separate figure.
class SubscriptionModel {
  final String id;
  final String serviceName;
  final double cost;
  final String billingCycle;
  final DateTime nextBillingDate;
  final String? category;
  final bool isActive;

  SubscriptionModel({
    required this.id,
    required this.serviceName,
    required this.cost,
    required this.billingCycle,
    required this.nextBillingDate,
    required this.category,
    required this.isActive,
  });

  /// The cost expressed monthly, matching the backend's normalisation.
  double get monthlyCost {
    switch (billingCycle) {
      case 'ANNUAL':
        return cost / 12;
      case 'QUARTERLY':
        return cost / 3;
      default:
        return cost;
    }
  }

  factory SubscriptionModel.fromJson(Map<String, dynamic> json) {
    const model = 'SubscriptionModel';

    final rawCycle = json['billingCycle'];
    final billingCycle = rawCycle is String && rawCycle.trim().isNotEmpty
        ? rawCycle.trim()
        : 'MONTHLY';

    final rawCategory = json['category'];
    final category = rawCategory is String && rawCategory.trim().isNotEmpty
        ? rawCategory.trim()
        : null;

    final rawActive = json['isActive'];

    return SubscriptionModel(
      id: parseRequiredString(json, 'id', model: model),
      serviceName: parseRequiredString(json, 'serviceName', model: model),
      cost: parseRequiredDouble(json, 'cost', model: model),
      billingCycle: billingCycle,
      nextBillingDate: parseRequiredDate(json, 'nextBillingDate', model: model),
      category: category,
      isActive: rawActive is bool ? rawActive : true,
    );
  }
}

/// The `summary` block from `GET /subscriptions`.
///
/// Parsed leniently for the same reason as `InsuranceSummaryModel`: it is a
/// derived aggregate, so the screen falls back to computing from the list
/// rather than failing. Preferring the server's totals and its pre-formatted
/// strings keeps the mobile headline identical to the web page's.
class SubscriptionSummaryModel {
  final int totalSubscriptions;
  final int activeSubscriptions;
  final double monthlyTotal;
  final String? formattedMonthlyTotal;
  final double annualTotal;
  final String? formattedAnnualTotal;

  SubscriptionSummaryModel({
    required this.totalSubscriptions,
    required this.activeSubscriptions,
    required this.monthlyTotal,
    required this.formattedMonthlyTotal,
    required this.annualTotal,
    required this.formattedAnnualTotal,
  });

  factory SubscriptionSummaryModel.fromJson(Map<String, dynamic> json) {
    return SubscriptionSummaryModel(
      totalSubscriptions: _asInt(json['totalSubscriptions']),
      activeSubscriptions: _asInt(json['activeSubscriptions']),
      monthlyTotal: _asDouble(json['monthlyTotal']),
      formattedMonthlyTotal: _asString(json['formattedMonthlyTotal']),
      annualTotal: _asDouble(json['annualTotal']),
      formattedAnnualTotal: _asString(json['formattedAnnualTotal']),
    );
  }
}

int _asInt(Object? value) => value is num ? value.toInt() : 0;

double _asDouble(Object? value) {
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value.trim()) ?? 0;
  return 0;
}

String? _asString(Object? value) {
  if (value is String && value.trim().isNotEmpty) return value.trim();
  return null;
}
