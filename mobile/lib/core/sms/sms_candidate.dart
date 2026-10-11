class SmsCandidate {
  final bool isTransaction;
  final String? rejectionReason;
  final double amount;
  final String currency;
  final String direction; // 'DEBIT' (EXPENSE) or 'CREDIT' (INCOME)
  final String merchant;
  final String? accountHint;
  final String? bankReference;
  final DateTime transactionDate;
  final String suggestedCategory;
  final double confidence;
  final String rawSender;
  final String rawBody;
  final String messageHash;

  SmsCandidate({
    required this.isTransaction,
    this.rejectionReason,
    this.amount = 0.0,
    this.currency = 'INR',
    this.direction = 'EXPENSE',
    this.merchant = 'Merchant',
    this.accountHint,
    this.bankReference,
    required this.transactionDate,
    this.suggestedCategory = 'General',
    this.confidence = 0.8,
    required this.rawSender,
    required this.rawBody,
    required this.messageHash,
  });

  bool get isIncome => direction == 'INCOME';

  Map<String, dynamic> toIngestJson() {
    return {
      'messageText': rawBody,
      'sender': rawSender,
      'rawMessageHash': messageHash,
    };
  }
}
