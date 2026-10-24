import 'model_parse.dart';

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
    const model = 'InvestmentModel';

    // The portfolio endpoint names these `averageBuyPrice`, `totalCost` and
    // `pnlPercent`; accept the short/legacy names too, then keep the derived
    // fallbacks for payloads that omit the value figures entirely.
    final qty = parseRequiredDouble(json, 'quantity', model: model);
    final bPrice = parseRequiredDoubleValue(
      json['averageBuyPrice'] ?? json['buyPrice'],
      field: 'averageBuyPrice',
      model: model,
    );
    final cPrice = json['currentPrice'] != null
        ? parseRequiredDoubleValue(
            json['currentPrice'],
            field: 'currentPrice',
            model: model,
          )
        : bPrice;
    final rawInvested = json['totalCost'] ?? json['investedValue'];
    final invVal = rawInvested != null
        ? parseRequiredDoubleValue(
            rawInvested,
            field: 'totalCost',
            model: model,
          )
        : (qty * bPrice);
    final curVal = json['currentValue'] != null
        ? parseRequiredDoubleValue(
            json['currentValue'],
            field: 'currentValue',
            model: model,
          )
        : (qty * cPrice);
    final rawReturns = json['pnlPercent'] ?? json['returnsPercent'];
    final retPct = rawReturns != null
        ? parseRequiredDoubleValue(
            rawReturns,
            field: 'pnlPercent',
            model: model,
          )
        : (invVal > 0 ? ((curVal - invVal) / invVal) * 100 : 0.0);

    return InvestmentModel(
      id: parseRequiredString(json, 'id', model: model),
      symbol: parseRequiredString(json, 'symbol', model: model),
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
