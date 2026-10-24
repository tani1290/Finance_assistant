import 'model_parse.dart';

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
    const model = 'TransactionModel';

    // The list endpoint flattens the relations to strings and renames the type
    // field (`type`, `category`, `account`), while the detail endpoint spreads
    // the raw Prisma row (`transactionType`, nested `category`/`account`
    // objects). Accept both shapes so every surface parses the same record.
    final type = _requiredType(json, model);

    String? accName;
    String? accountId;
    final rawAccount = json['account'];
    if (rawAccount is Map) {
      accName = _nonEmpty(rawAccount['name']);
      accountId = _optionalId(rawAccount['id']);
    } else {
      accName = _nonEmpty(rawAccount) ?? _nonEmpty(json['accountName']);
    }
    accountId ??= _optionalId(json['accountId']);

    String categoryName = 'Uncategorized';
    String? categoryId;
    final rawCategory = json['category'];
    if (rawCategory is Map) {
      categoryName = _nonEmpty(rawCategory['name']) ?? categoryName;
      categoryId = _optionalId(rawCategory['id']);
    } else {
      categoryName =
          _nonEmpty(rawCategory) ??
          _nonEmpty(json['categoryName']) ??
          categoryName;
    }
    categoryId ??= _optionalId(json['categoryId']);

    return TransactionModel(
      id: parseRequiredString(json, 'id', model: model),
      accountId: accountId,
      accountName: accName,
      categoryId: categoryId,
      categoryName: categoryName,
      amount: parseRequiredDouble(json, 'amount', model: model),
      transactionType: type,
      description: _nonEmpty(json['description']),
      merchant: _nonEmpty(json['merchant']),
      paymentMethod: _nonEmpty(json['paymentMethod']),
      date: parseRequiredDate(json, 'date', model: model),
      currency: _nonEmpty(json['currency']) ?? 'INR',
    );
  }
}

String _requiredType(Map<String, dynamic> json, String model) {
  final value = json['transactionType'] ?? json['type'];
  if (value is String && value.trim().isNotEmpty) {
    return value.trim().toUpperCase();
  }
  throw ModelParseException(model, 'transactionType');
}

String? _nonEmpty(Object? value) {
  if (value is String && value.trim().isNotEmpty) return value.trim();
  return null;
}

String? _optionalId(Object? value) {
  if (value == null) return null;
  final id = value.toString().trim();
  return id.isEmpty ? null : id;
}
