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
    return BudgetModel(
      id: json['id'] ?? '',
      categoryId: json['categoryId'],
      categoryName: json['categoryName'] ?? 'General',
      monthlyLimit: (json['monthlyLimit'] != null)
          ? double.tryParse(json['monthlyLimit'].toString()) ?? 0.0
          : 0.0,
      spent: (json['spent'] != null)
          ? double.tryParse(json['spent'].toString()) ?? 0.0
          : 0.0,
      month: json['month'] ?? DateTime.now().month,
      year: json['year'] ?? DateTime.now().year,
    );
  }
}
