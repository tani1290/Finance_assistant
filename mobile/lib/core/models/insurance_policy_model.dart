import 'model_parse.dart';

/// An insurance policy as returned by `GET /insurance`.
///
/// The premium cycle is stored as a code (`ANNUAL`, `MONTHLY`, `HALF_YEARLY`,
/// `QUARTERLY`) and [annualPremium] normalises it using the exact same rules as
/// the backend summary, so the headline figure can be recomputed from the
/// authoritative list rather than trusted from a separately-returned total.
class InsurancePolicyModel {
  final String id;
  final String policyName;
  final String? insurer;
  final String policyType;
  final double coverageAmount;
  final double premium;
  final String premiumCycle;
  final DateTime renewalDate;
  final bool isActive;

  InsurancePolicyModel({
    required this.id,
    required this.policyName,
    required this.insurer,
    required this.policyType,
    required this.coverageAmount,
    required this.premium,
    required this.premiumCycle,
    required this.renewalDate,
    required this.isActive,
  });

  /// The premium expressed annually, matching the backend's normalisation.
  double get annualPremium {
    switch (premiumCycle) {
      case 'MONTHLY':
        return premium * 12;
      case 'QUARTERLY':
        return premium * 4;
      case 'HALF_YEARLY':
        return premium * 2;
      default:
        return premium;
    }
  }

  factory InsurancePolicyModel.fromJson(Map<String, dynamic> json) {
    const model = 'InsurancePolicyModel';

    final rawInsurer = json['insurer'];
    final insurer = rawInsurer is String && rawInsurer.trim().isNotEmpty
        ? rawInsurer.trim()
        : null;

    final rawType = json['policyType'];
    final policyType = rawType is String && rawType.trim().isNotEmpty
        ? rawType.trim()
        : 'LIFE';

    final rawCycle = json['premiumCycle'];
    final premiumCycle = rawCycle is String && rawCycle.trim().isNotEmpty
        ? rawCycle.trim()
        : 'ANNUAL';

    final rawActive = json['isActive'];

    return InsurancePolicyModel(
      id: parseRequiredString(json, 'id', model: model),
      policyName: parseRequiredString(json, 'policyName', model: model),
      insurer: insurer,
      policyType: policyType,
      coverageAmount: parseRequiredDouble(json, 'coverageAmount', model: model),
      premium: parseRequiredDouble(json, 'premium', model: model),
      premiumCycle: premiumCycle,
      renewalDate: parseRequiredDate(json, 'renewalDate', model: model),
      isActive: rawActive is bool ? rawActive : true,
    );
  }
}

/// The `summary` block from `GET /insurance`.
///
/// Parsed leniently: it is a derived aggregate, so a missing field degrades the
/// headline figure (see `InsuranceScreen`'s client-side fallback) rather than
/// failing the whole screen. Reading the server's own totals keeps the mobile
/// headline identical to the web page's, including the rounding of its
/// pre-formatted strings.
class InsuranceSummaryModel {
  final int totalPolicies;
  final int activePolicies;
  final double totalCoverage;
  final String? formattedTotalCoverage;
  final double annualPremium;
  final String? formattedAnnualPremium;
  final DateTime? nextRenewal;

  InsuranceSummaryModel({
    required this.totalPolicies,
    required this.activePolicies,
    required this.totalCoverage,
    required this.formattedTotalCoverage,
    required this.annualPremium,
    required this.formattedAnnualPremium,
    required this.nextRenewal,
  });

  factory InsuranceSummaryModel.fromJson(Map<String, dynamic> json) {
    return InsuranceSummaryModel(
      totalPolicies: _asInt(json['totalPolicies']),
      activePolicies: _asInt(json['activePolicies']),
      totalCoverage: _asDouble(json['totalCoverage']),
      formattedTotalCoverage: _asString(json['formattedTotalCoverage']),
      annualPremium: _asDouble(json['annualPremium']),
      formattedAnnualPremium: _asString(json['formattedAnnualPremium']),
      nextRenewal: _asDate(json['nextRenewal']),
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

DateTime? _asDate(Object? value) {
  if (value is String && value.trim().isNotEmpty) {
    return DateTime.tryParse(value.trim());
  }
  return null;
}
