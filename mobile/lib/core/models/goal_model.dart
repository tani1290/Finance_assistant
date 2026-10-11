class GoalModel {
  final String id;
  final String name;
  final double targetAmount;
  final double currentAmount;
  final DateTime? targetDate;
  final String? category;

  GoalModel({
    required this.id,
    required this.name,
    required this.targetAmount,
    required this.currentAmount,
    this.targetDate,
    this.category,
  });

  double get progress => targetAmount > 0 ? (currentAmount / targetAmount).clamp(0.0, 1.0) : 0.0;
  bool get isAchieved => currentAmount >= targetAmount;

  factory GoalModel.fromJson(Map<String, dynamic> json) {
    DateTime? parsedTarget;
    if (json['targetDate'] != null) {
      try {
        parsedTarget = DateTime.parse(json['targetDate'].toString());
      } catch (_) {}
    }

    return GoalModel(
      id: json['id'] ?? '',
      name: json['name'] ?? '',
      targetAmount: (json['targetAmount'] != null) ? double.tryParse(json['targetAmount'].toString()) ?? 0.0 : 0.0,
      currentAmount: (json['currentAmount'] != null) ? double.tryParse(json['currentAmount'].toString()) ?? 0.0 : 0.0,
      targetDate: parsedTarget,
      category: json['category'],
    );
  }
}
