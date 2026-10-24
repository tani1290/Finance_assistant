import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:finpro_mobile/core/api/api_client.dart';
import 'package:finpro_mobile/core/models/investment_model.dart';
import 'package:finpro_mobile/core/models/loan_model.dart';
import 'package:finpro_mobile/core/models/model_parse.dart';
import 'package:finpro_mobile/core/models/transaction_model.dart';
import 'package:finpro_mobile/features/investments/investments_screen.dart';
import 'package:finpro_mobile/features/loans/loans_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

// ─────────────────────────────────────────────────────────────────────────
// These fixtures are copied from the shapes the node-backend controllers
// actually return (transactionController.js, loanController.js,
// investmentController.js). If a contract key is renamed on the server, the
// matching test here must fail before the regression reaches users.
// ─────────────────────────────────────────────────────────────────────────

/// GET /api/v1/transactions — one flattened row.
Map<String, dynamic> _listTransaction() => {
  'id': 'txn-1',
  'amount': 1250.75,
  'formattedAmount': '₹1,250.75',
  'type': 'INCOME',
  'category': 'Salary',
  'account': 'HDFC Savings',
  'description': '',
  'merchant': '',
  'date': '2026-10-01T00:00:00.000Z',
  'currency': 'INR',
  'createdAt': '2026-10-01T09:30:00.000Z',
};

/// GET /api/v1/transactions/:id — raw Prisma row with nested relations.
Map<String, dynamic> _detailTransaction() => {
  'id': 'txn-2',
  'userId': 'u1',
  'accountId': 'acc-1',
  'categoryId': 'cat-1',
  'amount': '99.50',
  'transactionType': 'EXPENSE',
  'description': 'Morning coffee',
  'merchant': 'Blue Tokai',
  'notes': null,
  'paymentMethod': 'UPI',
  'date': '2026-10-02T00:00:00.000Z',
  'currency': 'INR',
  'category': {'id': 'cat-1', 'name': 'Food & Dining'},
  'account': {'id': 'acc-1', 'name': 'HDFC Savings'},
};

/// One entry of GET /api/v1/loans -> data.loans.
Map<String, dynamic> _loanItem() => {
  'id': 'loan-1',
  'loanType': 'HOME',
  'lenderName': 'HDFC Bank',
  'principalAmount': 5000000,
  'interestRate': 8.5,
  'tenureMonths': 240,
  'startDate': '2024-01-01T00:00:00.000Z',
  'emiAmount': 42000,
  'outstandingBalance': 4850000,
  'status': 'ACTIVE',
};

/// One entry of GET /api/v1/investments/portfolio -> data.holdings.
Map<String, dynamic> _holding() => {
  'id': 'inv-1',
  'symbol': 'INFY',
  'name': 'Infosys Ltd',
  'assetType': 'STOCK',
  'quantity': 10,
  'averageBuyPrice': 1500,
  'currentPrice': 1650,
  'totalCost': 15000,
  'currentValue': 16500,
  'pnl': 1500,
  'pnlPercent': 10.0,
};

class _JsonAdapter implements HttpClientAdapter {
  _JsonAdapter(this.body);

  final Object body;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    return ResponseBody.fromString(
      jsonEncode(body),
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
  });

  group('transaction contract', () {
    test('parses the flattened list payload', () {
      final tx = TransactionModel.fromJson(_listTransaction());
      expect(tx.id, 'txn-1');
      expect(tx.amount, 1250.75);
      expect(tx.transactionType, 'INCOME');
      expect(tx.isIncome, isTrue);
      expect(tx.categoryName, 'Salary');
      expect(tx.accountName, 'HDFC Savings');
      // Empty strings must not leak through as a blank title/description.
      expect(tx.merchant, isNull);
      expect(tx.description, isNull);
    });

    test('parses the raw Prisma detail payload', () {
      final tx = TransactionModel.fromJson(_detailTransaction());
      expect(tx.transactionType, 'EXPENSE');
      expect(tx.isIncome, isFalse);
      expect(tx.categoryId, 'cat-1');
      expect(tx.categoryName, 'Food & Dining');
      expect(tx.accountId, 'acc-1');
      expect(tx.accountName, 'HDFC Savings');
      expect(tx.paymentMethod, 'UPI');
    });

    test('rejects a record with no type field at all', () {
      final json = _listTransaction()..remove('type');
      expect(
        () => TransactionModel.fromJson(json),
        throwsA(isA<ModelParseException>()),
      );
    });
  });

  group('loan contract', () {
    test('parses the loans list payload (lenderName/outstandingBalance)', () {
      final loan = LoanModel.fromJson(_loanItem());
      expect(loan.id, 'loan-1');
      expect(loan.lender, 'HDFC Bank');
      expect(loan.loanType, 'HOME');
      expect(loan.principalAmount, 5000000);
      expect(loan.outstandingAmount, 4850000);
      expect(loan.emiAmount, 42000);
      expect(loan.tenureMonths, 240);
    });

    test('rejects a record with no outstanding figure', () {
      final json = _loanItem()..remove('outstandingBalance');
      expect(
        () => LoanModel.fromJson(json),
        throwsA(isA<ModelParseException>()),
      );
    });
  });

  group('investment contract', () {
    test('parses the portfolio holding payload', () {
      final inv = InvestmentModel.fromJson(_holding());
      expect(inv.symbol, 'INFY');
      expect(inv.name, 'Infosys Ltd');
      expect(inv.quantity, 10);
      expect(inv.buyPrice, 1500); // averageBuyPrice
      expect(inv.currentPrice, 1650);
      expect(inv.investedValue, 15000); // totalCost
      expect(inv.currentValue, 16500);
      expect(inv.returnsPercent, 10.0); // pnlPercent
      expect(inv.isProfit, isTrue);
    });

    test('rejects a holding with no quantity', () {
      final json = _holding()..remove('quantity');
      expect(
        () => InvestmentModel.fromJson(json),
        throwsA(isA<ModelParseException>()),
      );
    });
  });

  group('screen envelopes', () {
    testWidgets('LoansScreen renders the {loans:[...]} envelope', (
      tester,
    ) async {
      apiClient.dio.httpClientAdapter = _JsonAdapter({
        'success': true,
        'data': {
          'totalOutstanding': 4850000,
          'totalMonthlyEMI': 42000,
          'loans': [_loanItem()],
        },
      });

      await tester.pumpWidget(const MaterialApp(home: LoansScreen()));
      await tester.pumpAndSettle();

      expect(find.text('HDFC Bank'), findsOneWidget);
      expect(find.text('HOME'), findsOneWidget);
      expect(find.text('No Active Loans'), findsNothing);
    });

    testWidgets('InvestmentsScreen renders the {holdings:[...]} envelope', (
      tester,
    ) async {
      apiClient.dio.httpClientAdapter = _JsonAdapter({
        'success': true,
        'data': {
          'totalInvested': 15000,
          'currentValue': 16500,
          'totalPnlPercent': 10.0,
          'holdings': [_holding()],
        },
      });

      await tester.pumpWidget(const MaterialApp(home: InvestmentsScreen()));
      await tester.pumpAndSettle();

      expect(find.text('INFY'), findsOneWidget);
      expect(find.textContaining('10.0%'), findsWidgets);
      expect(find.text('No Investments Found'), findsNothing);
    });
  });
}
