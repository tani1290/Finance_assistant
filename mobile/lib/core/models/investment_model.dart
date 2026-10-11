class InvestmentModel {
  final String id;
  final String symbol;
  final String name;
  final String assetType; // STOCK, MUTUAL_FUND, GOLD, CRYPTO
  final double quantity;
  final double buyPrice;
  final double currentPrice;
  final double investedValue;
  final double currentValue;
  final double returnsPercent;

  InvestmentModel({
    required this.id,
    required this.symbol,
    required this.name,
    required this.assetType,
    required this.quantity,
    required this.buyPrice,
    required this.currentPrice,
    required this.investedValue,
    required this.currentValue,
    required this.returnsPercent,
  });

  bool get isProfit => returnsPercent >= 0;

  factory InvestmentModel.fromJson(Map<String, dynamic> json) {
    final qty = (json['quantity'] != null)
        ? double.tryParse(json['quantity'].toString()) ?? 0.0
        : 0.0;
    final bPrice = (json['buyPrice'] != null)
        ? double.tryParse(json['buyPrice'].toString()) ?? 0.0
        : 0.0;
    final cPrice = (json['currentPrice'] != null)
        ? double.tryParse(json['currentPrice'].toString()) ?? bPrice
        : bPrice;
    final invVal = (json['investedValue'] != null)
        ? double.tryParse(json['investedValue'].toString()) ?? (qty * bPrice)
        : (qty * bPrice);
    final curVal = (json['currentValue'] != null)
        ? double.tryParse(json['currentValue'].toString()) ?? (qty * cPrice)
        : (qty * cPrice);
    final retPct = (json['returnsPercent'] != null)
        ? double.tryParse(json['returnsPercent'].toString()) ?? 0.0
        : (invVal > 0 ? ((curVal - invVal) / invVal) * 100 : 0.0);

    return InvestmentModel(
      id: json['id'] ?? '',
      symbol: json['symbol'] ?? '',
      name: json['name'] ?? json['symbol'] ?? 'Asset',
      assetType: json['assetType'] ?? 'STOCK',
      quantity: qty,
      buyPrice: bPrice,
      currentPrice: cPrice,
      investedValue: invVal,
      currentValue: curVal,
      returnsPercent: retPct,
    );
  }
}
