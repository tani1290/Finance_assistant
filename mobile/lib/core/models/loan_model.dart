import 'model_parse.dart';

class LoanModel {
  final String id;
  final String lender;
  final String loanType; // HOME, AUTO, PERSONAL, EDUCATION
  final double principalAmount;
  final double outstandingAmount;
  final double interestRate;
  final double emiAmount;
  final int tenureMonths;

  LoanModel({
    required this.id,
    required this.lender,
    required this.loanType,
    required this.principalAmount,
    required this.outstandingAmount,
    required this.interestRate,
    required this.emiAmount,
    required this.tenureMonths,
  });

  factory LoanModel.fromJson(Map<String, dynamic> json) {
    const model = 'LoanModel';

    // The list/create endpoints name these `lenderName` and `outstandingBalance`;
    // keep accepting the short forms used by older payloads and fixtures.
    final lender = json['lenderName'] ?? json['lender'];
    final loanType = json['loanType'];
    final outstanding = json['outstandingBalance'] ?? json['outstandingAmount'];

    return LoanModel(
      id: parseRequiredString(json, 'id', model: model),
      lender: lender is String && lender.trim().isNotEmpty
          ? lender.trim()
          : 'Bank',
      loanType: loanType is String && loanType.trim().isNotEmpty
          ? loanType.trim().toUpperCase()
          : 'PERSONAL',
      principalAmount: parseRequiredDouble(
        json,
        'principalAmount',
        model: model,
      ),
      outstandingAmount: parseRequiredDoubleValue(
        outstanding,
        field: 'outstandingBalance',
        model: model,
      ),
      interestRate: parseRequiredDouble(json, 'interestRate', model: model),
      emiAmount: parseRequiredDouble(json, 'emiAmount', model: model),
      tenureMonths: parseRequiredInt(json, 'tenureMonths', model: model),
    );
  }
}
