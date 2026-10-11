class TransactionModel {
  final String id;
  final String? accountId;
  final String? accountName;
  final String? categoryId;
  final String categoryName;
  final double amount;
  final String transactionType; // EXPENSE, INCOME, TRANSFER
  final String? description;
  final String? merchant;
  final String? paymentMethod;
  final DateTime date;
  final String currency;

  TransactionModel({
    required this.id,
    this.accountId,
    this.accountName,
    this.categoryId,
    this.categoryName = 'General',
    required this.amount,
    required this.transactionType,
    this.description,
    this.merchant,
    this.paymentMethod,
    required this.date,
    this.currency = 'INR',
  });

  bool get isIncome => transactionType == 'INCOME';

  factory TransactionModel.fromJson(Map<String, dynamic> json) {
    DateTime parsedDate;
    try {
      parsedDate = json['date'] != null
          ? DateTime.parse(json['date'].toString())
          : DateTime.now();
    } catch (_) {
      parsedDate = DateTime.now();
    }

    String catName = 'General';
    if (json['category'] != null && json['category'] is Map) {
      catName = json['category']['name'] ?? 'General';
    } else if (json['categoryName'] != null) {
      catName = json['categoryName'];
    }

    String? accName;
    if (json['account'] != null && json['account'] is Map) {
      accName = json['account']['name'];
    }

    return TransactionModel(
      id: json['id'] ?? '',
      accountId: json['accountId'],
      accountName: accName,
      categoryId: json['categoryId'],
      categoryName: catName,
      amount: (json['amount'] != null)
          ? double.tryParse(json['amount'].toString()) ?? 0.0
          : 0.0,
      transactionType: json['transactionType'] ?? 'EXPENSE',
      description: json['description'],
      merchant: json['merchant'],
      paymentMethod: json['paymentMethod'],
      date: parsedDate,
      currency: json['currency'] ?? 'INR',
    );
  }
}
