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
    return LoanModel(
      id: json['id'] ?? '',
      lender: json['lender'] ?? 'Bank',
      loanType: json['loanType'] ?? 'PERSONAL',
      principalAmount: (json['principalAmount'] != null) ? double.tryParse(json['principalAmount'].toString()) ?? 0.0 : 0.0,
      outstandingAmount: (json['outstandingAmount'] != null) ? double.tryParse(json['outstandingAmount'].toString()) ?? 0.0 : 0.0,
      interestRate: (json['interestRate'] != null) ? double.tryParse(json['interestRate'].toString()) ?? 0.0 : 0.0,
      emiAmount: (json['emiAmount'] != null) ? double.tryParse(json['emiAmount'].toString()) ?? 0.0 : 0.0,
      tenureMonths: json['tenureMonths'] ?? 12,
    );
  }
}
