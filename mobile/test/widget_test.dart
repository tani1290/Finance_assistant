import 'package:flutter_test/flutter_test.dart';
import 'package:finpro_mobile/core/sms/sms_parser.dart';
import 'package:finpro_mobile/core/utils/currency_formatter.dart';
import 'package:finpro_mobile/core/utils/date_formatter.dart';
import 'package:finpro_mobile/core/models/transaction_model.dart';
import 'package:finpro_mobile/core/models/pending_sms_model.dart';

void main() {
  group('SmsParser Engine Acceptance Tests', () {
    test('Correctly extracts debit transaction from standard Indian bank SMS', () {
      const sms = 'Rs. 450.00 debited from A/c XX1234 on 10-Oct-2026 at SWIGGY. Avl Bal Rs 15,200. Ref: SWG987654.';
      final candidate = SmsParser.parse(sms, sender: 'HDFCBK');

      expect(candidate.isTransaction, isTrue);
      expect(candidate.amount, equals(450.0));
      expect(candidate.direction, equals('EXPENSE'));
      expect(candidate.merchant, equals('Swiggy'));
      expect(candidate.suggestedCategory, equals('Food & Dining'));
      expect(candidate.accountHint, equals('1234'));
      expect(candidate.bankReference, equals('SWG987654'));
    });

    test('Correctly extracts salary credit from bank SMS', () {
      const sms = 'Your A/c XX5678 is credited with INR 85,000.00 on 01-OCT-2026 by Salary/TechCorp India. Avl Bal INR 1,12,000.';
      final candidate = SmsParser.parse(sms, sender: 'SBIBNK');

      expect(candidate.isTransaction, isTrue);
      expect(candidate.amount, equals(85000.0));
      expect(candidate.direction, equals('INCOME'));
      expect(candidate.suggestedCategory, equals('Salary'));
      expect(candidate.accountHint, equals('5678'));
    });

    test('Filters out OTP authentication messages for privacy', () {
      const otpSms = 'Your OTP for transaction of Rs 500 at Zomato is 482910. Do not share with anyone.';
      final candidate = SmsParser.parse(otpSms, sender: 'VM-ZOMATO');

      expect(candidate.isTransaction, isFalse);
      expect(candidate.rejectionReason, contains('OTP'));
    });

    test('Filters out promotional loan offers', () {
      const promoSms = 'Get instant personal loan of Rs 5,00,000 approved in 5 minutes! Click here to claim offer.';
      final candidate = SmsParser.parse(promoSms, sender: 'BAJAJF');

      expect(candidate.isTransaction, isFalse);
      expect(candidate.rejectionReason, contains('Promotional'));
    });

    test('Filters out collect payment requests', () {
      const reqSms = 'PhonePe: User Amit has requested Rs 300 from you. Pay before 5pm.';
      final candidate = SmsParser.parse(reqSms, sender: 'PhonePe');

      expect(candidate.isTransaction, isFalse);
      expect(candidate.rejectionReason, contains('Request'));
    });

    test('Filters out failed / declined transactions', () {
      const failSms = 'Transaction of Rs 1,200.00 on Card ending 1234 DECLINED due to incorrect PIN.';
      final candidate = SmsParser.parse(failSms, sender: 'ICICIB');

      expect(candidate.isTransaction, isFalse);
      expect(candidate.rejectionReason, contains('Declined'));
    });
  });

  group('Currency & Date Formatter Tests', () {
    test('Formats Indian Rupee values with proper commas', () {
      expect(CurrencyFormatter.format(150000), equals('₹1,50,000'));
      expect(CurrencyFormatter.compact(150000), equals('₹1.50 L'));
      expect(CurrencyFormatter.compact(12000000), equals('₹1.20 Cr'));
    });

    test('DateFormatter handles relative and formatted timestamps', () {
      final now = DateTime.now();
      expect(DateFormatter.relative(now), equals('Just now'));
      expect(DateFormatter.format(DateTime(2026, 10, 10)), equals('10 Oct 2026'));
    });
  });

  group('Model Serialization Tests', () {
    test('TransactionModel parses JSON cleanly', () {
      final json = {
        'id': 'tx-123',
        'amount': 450.50,
        'transactionType': 'EXPENSE',
        'merchant': 'Swiggy',
        'categoryName': 'Food & Dining',
        'date': '2026-10-10T12:00:00.000Z',
      };
      final tx = TransactionModel.fromJson(json);

      expect(tx.id, equals('tx-123'));
      expect(tx.amount, equals(450.50));
      expect(tx.isIncome, isFalse);
      expect(tx.merchant, equals('Swiggy'));
    });

    test('PendingSmsModel parses JSON cleanly', () {
      final json = {
        'id': 'sms-456',
        'amount': 85000,
        'transactionType': 'INCOME',
        'merchant': 'TechCorp',
        'suggestedCategory': 'Salary',
        'status': 'PENDING',
        'transactionDate': '2026-10-01T09:00:00.000Z',
      };
      final pending = PendingSmsModel.fromJson(json);

      expect(pending.id, equals('sms-456'));
      expect(pending.isIncome, isTrue);
      expect(pending.isPending, isTrue);
      expect(pending.amount, equals(85000.0));
    });
  });
}
