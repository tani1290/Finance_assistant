import 'model_parse.dart';

class BudgetModel {
  final String id;
  final String? categoryId;
  final String categoryName;
  final double monthlyLimit;
  final double spent;
  final int month;
  final int year;

  BudgetModel({
    required this.id,
    this.categoryId,
    required this.categoryName,
    required this.monthlyLimit,
    this.spent = 0.0,
    required this.month,
    required this.year,
  });

  double get percentage =>
      monthlyLimit > 0 ? (spent / monthlyLimit).clamp(0.0, 1.0) : 0.0;
  double get remaining => monthlyLimit - spent;
  bool get isOverBudget => spent > monthlyLimit;

  factory BudgetModel.fromJson(Map<String, dynamic> json) {
    const model = 'BudgetModel';
    return BudgetModel(
      id: parseRequiredString(json, 'id', model: model),
      categoryId: json['categoryId'],
      categoryName: json['categoryName'] ?? 'General',
      monthlyLimit: parseRequiredDouble(json, 'monthlyLimit', model: model),
      // A budget with no spend is legitimately zero, so an absent `spent` is
      // safe to default. A present-but-invalid value is rejected.
      spent: json['spent'] != null
          ? parseRequiredDouble(json, 'spent', model: model)
          : 0.0,
      month: parseRequiredInt(json, 'month', model: model),
      year: parseRequiredInt(json, 'year', model: model),
    );
  }
}
