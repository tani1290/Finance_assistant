class PendingSmsModel {
  final String id;
  final double amount;
  final String currency;
  final String transactionType; // EXPENSE, INCOME
  final String? merchant;
  final String? accountHint;
  final String? matchedAccountId;
  final String? matchedAccountName;
  final String? suggestedCategory;
  final double? confidence;
  final String? categoryReason;
  final String status; // PENDING, CONFIRMED, REJECTED
  final String? rawSender;
  final String? bankReference;
  final DateTime transactionDate;
  final bool isDuplicate;
  final String? duplicateReason;
  final String? confirmedTransactionId;

  PendingSmsModel({
    required this.id,
    required this.amount,
    this.currency = 'INR',
    required this.transactionType,
    this.merchant,
    this.accountHint,
    this.matchedAccountId,
    this.matchedAccountName,
    this.suggestedCategory,
    this.confidence,
    this.categoryReason,
    this.status = 'PENDING',
    this.rawSender,
    this.bankReference,
    required this.transactionDate,
    this.isDuplicate = false,
    this.duplicateReason,
    this.confirmedTransactionId,
  });

  bool get isIncome => transactionType == 'INCOME';
  bool get isPending => status == 'PENDING';

  factory PendingSmsModel.fromJson(Map<String, dynamic> json) {
    DateTime txDate;
    try {
      txDate = json['transactionDate'] != null
          ? DateTime.parse(json['transactionDate'].toString())
          : DateTime.now();
    } catch (_) {
      txDate = DateTime.now();
    }

    String? accName;
    if (json['matchedAccount'] != null && json['matchedAccount'] is Map) {
      accName = json['matchedAccount']['name'];
    }

    return PendingSmsModel(
      id: json['id'] ?? '',
      amount: (json['amount'] != null)
          ? double.tryParse(json['amount'].toString()) ?? 0.0
          : 0.0,
      currency: json['currency'] ?? 'INR',
      transactionType: json['transactionType'] ?? 'EXPENSE',
      merchant: json['merchant'],
      accountHint: json['accountHint'],
      matchedAccountId: json['matchedAccountId'],
      matchedAccountName: accName,
      suggestedCategory: json['suggestedCategory'] ?? 'General',
      confidence: (json['confidence'] != null)
          ? double.tryParse(json['confidence'].toString())
          : null,
      categoryReason: json['categoryReason'],
      status: json['status'] ?? 'PENDING',
      rawSender: json['rawSender'],
      bankReference: json['bankReference'],
      transactionDate: txDate,
      isDuplicate: json['isDuplicate'] ?? false,
      duplicateReason: json['duplicateReason'],
      confirmedTransactionId: json['confirmedTransactionId'],
    );
  }
}
