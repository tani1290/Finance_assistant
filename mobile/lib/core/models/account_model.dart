class AccountModel {
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

  factory AccountModel.fromJson(Map<String, dynamic> json) {
    return AccountModel(
      id: json['id'] ?? '',
      name: json['name'] ?? '',
      institution: json['institution'],
      accountType: json['accountType'] ?? 'BANK',
      accountNumberMasked: json['accountNumberMasked'],
      balance: (json['balance'] != null) ? double.tryParse(json['balance'].toString()) ?? 0.0 : 0.0,
      currency: json['currency'] ?? 'INR',
      isActive: json['isActive'] ?? true,
    );
  }
}
