import 'model_parse.dart';

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

  double get progress =>
      targetAmount > 0 ? (currentAmount / targetAmount).clamp(0.0, 1.0) : 0.0;
  bool get isAchieved => currentAmount >= targetAmount;

  factory GoalModel.fromJson(Map<String, dynamic> json) {
    const model = 'GoalModel';

    // `targetDate` is optional. Absent means no deadline; a present but
    // unparseable value is rejected rather than silently dropped.
    DateTime? parsedTarget;
    final rawTarget = json['targetDate'];
    if (rawTarget != null) {
      parsedTarget = rawTarget is String
          ? DateTime.tryParse(rawTarget.trim())
          : null;
      if (parsedTarget == null) {
        throw const ModelParseException('GoalModel', 'targetDate');
      }
    }

    return GoalModel(
      id: parseRequiredString(json, 'id', model: model),
      name: parseRequiredString(json, 'name', model: model),
      targetAmount: parseRequiredDouble(json, 'targetAmount', model: model),
      currentAmount: parseRequiredDouble(json, 'currentAmount', model: model),
      targetDate: parsedTarget,
      category: json['category'],
    );
  }
}
