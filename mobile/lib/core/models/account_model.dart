import 'model_parse.dart';

class AccountModel {
  /// Must mirror the backend `AccountType` Prisma enum.
  ///
  /// `CASH_WALLET` and `CASH_IN_HAND` are additive categories; the older
  /// `CASH` and `WALLET` values remain valid for existing records.
  static const List<String> accountTypeValues = [
    'BANK',
    'CASH',
    'WALLET',
    'CREDIT_CARD',
    'CASH_WALLET',
    'CASH_IN_HAND',
    'SAVINGS',
    'CURRENT',
    'OTHER',
  ];

  static const Map<String, String> _accountTypeLabels = {
    'BANK': 'Bank Account',
    'CASH': 'Cash',
    'WALLET': 'Wallet',
    'CREDIT_CARD': 'Credit Card',
    'CASH_WALLET': 'Cash Wallet',
    'CASH_IN_HAND': 'Cash in Hand',
    'SAVINGS': 'Savings Account',
    'CURRENT': 'Current Account',
    'OTHER': 'Other',
  };

  final String id;
  final String name;
  final String? institution;
  final String accountType;
  final String? accountNumberMasked;
  final double balance;
  final String currency;
  final bool isActive;

  AccountModel({
    required this.id,
    required this.name,
    this.institution,
    required this.accountType,
    this.accountNumberMasked,
    required this.balance,
    this.currency = 'INR',
    this.isActive = true,
  });

  /// Human-readable label for a category, with a safe fallback for a value
  /// written by a newer server (never crash or show raw snake_case).
  static String labelForAccountType(String type) {
    final known = _accountTypeLabels[type];
    if (known != null) return known;
    final words = type.replaceAll('_', ' ').toLowerCase().trim();
    if (words.isEmpty) return 'Other';
    return words
        .split(' ')
        .map((w) => w.isEmpty ? w : '${w[0].toUpperCase()}${w.substring(1)}')
        .join(' ');
  }

  /// Friendly label for this account's category.
  String get accountTypeLabel => labelForAccountType(accountType);

  /// Cash-like accounts do not carry a bank account number.
  bool get isCashLike =>
      accountType == 'CASH' ||
      accountType == 'CASH_WALLET' ||
      accountType == 'CASH_IN_HAND' ||
      accountType == 'OTHER';

  factory AccountModel.fromJson(Map<String, dynamic> json) {
    const model = 'AccountModel';
    final rawType = json['accountType']?.toString().trim().toUpperCase();
    return AccountModel(
      id: parseRequiredString(json, 'id', model: model),
      name: parseRequiredString(json, 'name', model: model),
      institution: json['institution'],
      accountType: (rawType == null || rawType.isEmpty) ? 'BANK' : rawType,
      accountNumberMasked: json['accountNumberMasked'],
      balance: parseRequiredDouble(json, 'balance', model: model),
      currency: json['currency'] ?? 'INR',
      isActive: json['isActive'] ?? true,
    );
  }
}
