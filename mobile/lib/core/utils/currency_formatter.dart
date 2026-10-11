import 'package:intl/intl.dart';

class CurrencyFormatter {
  static final NumberFormat _inrFormatter = NumberFormat.currency(
    locale: 'en_IN',
    symbol: '₹',
    decimalDigits: 0,
  );

  static final NumberFormat _inrWithDecimals = NumberFormat.currency(
    locale: 'en_IN',
    symbol: '₹',
    decimalDigits: 2,
  );

  static String format(num? amount, {bool includeDecimals = false}) {
    if (amount == null) return '₹0';
    if (includeDecimals) {
      return _inrWithDecimals.format(amount);
    }
    return _inrFormatter.format(amount);
  }

  static String compact(num? amount) {
    if (amount == null) return '₹0';
    final abs = amount.abs();
    if (abs >= 10000000) {
      return '₹${(amount / 10000000).toStringAsFixed(2)} Cr';
    } else if (abs >= 100000) {
      return '₹${(amount / 100000).toStringAsFixed(2)} L';
    } else if (abs >= 1000) {
      return '₹${(amount / 1000).toStringAsFixed(1)} k';
    }
    return format(amount);
  }
}
