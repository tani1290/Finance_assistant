import 'package:finpro_mobile/core/models/budget_model.dart';
import 'package:finpro_mobile/core/models/goal_model.dart';
import 'package:finpro_mobile/core/models/investment_model.dart';
import 'package:finpro_mobile/core/models/loan_model.dart';
import 'package:finpro_mobile/core/models/model_parse.dart';
import 'package:finpro_mobile/core/models/transaction_model.dart';
import 'package:flutter_test/flutter_test.dart';

/// Financial-correctness checks.
///
/// Payloads are copied from the backend controllers (list envelopes, detail
/// spreads and portfolio rows), so a green test means the real wire shape is
/// classified and totalled correctly. The point of these tests is that money
/// is never silently zeroed or replaced: a missing amount must fail loudly.
void main() {
  group('transaction income classification', () {
    test('INCOME is the only credit type', () {
      TransactionModel tx(String type) => TransactionModel.fromJson({
        'id': 't1',
        'amount': 100,
        'transactionType': type,
        'date': '2026-10-15T09:30:00.000Z',
      });

      expect(tx('INCOME').isIncome, isTrue);
      expect(tx('EXPENSE').isIncome, isFalse);
      expect(tx('TRANSFER').isIncome, isFalse);
      expect(tx('INVESTMENT').isIncome, isFalse);
      expect(tx('LOAN_PAYMENT').isIncome, isFalse);
    });

    test('the list shape maps type/category/account onto the same model', () {
      final tx = TransactionModel.fromJson({
        'id': 't1',
        'amount': 120.5,
        'type': 'EXPENSE',
        'category': 'Food & Dining',
        'account': 'HDFC Savings',
        'date': '2026-10-15T09:30:00.000Z',
      });

      expect(tx.transactionType, 'EXPENSE');
      expect(tx.categoryName, 'Food & Dining');
      expect(tx.accountName, 'HDFC Savings');
      expect(tx.amount, 120.5);
    });
  });

  group('monetary parsing never fabricates a value', () {
    test('accepts a JSON number and a decimal string equally', () {
      expect(
        parseRequiredDouble({'amount': 120.5}, 'amount', model: 'M'),
        120.5,
      );
      expect(
        parseRequiredDouble({'amount': '120.50'}, 'amount', model: 'M'),
        120.5,
      );
    });

    test('a legitimate zero is preserved, not treated as missing', () {
      expect(parseRequiredDouble({'amount': 0}, 'amount', model: 'M'), 0.0);
      expect(
        parseRequiredDouble({'amount': '0.00'}, 'amount', model: 'M'),
        0.0,
      );
    });

    test('a missing amount is rejected instead of defaulting to zero', () {
      expect(
        () => parseRequiredDouble({'id': 't1'}, 'amount', model: 'M'),
        throwsA(isA<ModelParseException>()),
      );
    });

    test('a non-numeric amount is rejected', () {
      expect(
        () => parseRequiredDouble({'amount': 'abc'}, 'amount', model: 'M'),
        throwsA(isA<ModelParseException>()),
      );
    });

    test('a missing transaction date is rejected, never replaced by now()', () {
      expect(
        () => TransactionModel.fromJson({
          'id': 't1',
          'amount': 100,
          'transactionType': 'EXPENSE',
        }),
        throwsA(isA<ModelParseException>()),
      );
    });
  });

  group('loan principal and outstanding balance', () {
    // Copied from GET /loans: the create amount and the remaining balance are
    // distinct fields and must not be conflated.
    final listRow = {
      'id': 'l1',
      'loanType': 'HOME',
      'lenderName': 'HDFC Bank',
      'principalAmount': 2000000,
      'outstandingBalance': 1500000,
      'interestRate': 8.5,
      'tenureMonths': 240,
      'emiAmount': 17356,
    };

    test('keeps principal and outstanding as separate figures', () {
      final loan = LoanModel.fromJson(listRow);

      expect(loan.principalAmount, 2000000);
      expect(loan.outstandingAmount, 1500000);
      expect(loan.outstandingAmount, isNot(loan.principalAmount));
    });

    test('a fully repaid loan keeps its zero outstanding balance', () {
      final loan = LoanModel.fromJson({...listRow, 'outstandingBalance': 0});

      expect(loan.outstandingAmount, 0.0);
      expect(loan.principalAmount, 2000000);
    });

    test('a missing outstanding balance is rejected, not read as principal', () {
      final row = Map<String, dynamic>.from(listRow)..remove('outstandingBalance');

      expect(
        () => LoanModel.fromJson(row),
        throwsA(isA<ModelParseException>()),
      );
    });
  });

  group('investment value and profit', () {
    // Copied from GET /investments/portfolio.
    final holding = {
      'id': 'i1',
      'symbol': 'RELIANCE',
      'name': 'Reliance Industries',
      'assetType': 'STOCK',
      'quantity': 10,
      'averageBuyPrice': 1000,
      'currentPrice': 1200,
      'totalCost': 10000,
      'currentValue': 12000,
      'pnlPercent': 20,
    };

    test('reads cost, current value and return from the portfolio shape', () {
      final inv = InvestmentModel.fromJson(holding);

      expect(inv.investedValue, 10000);
      expect(inv.currentValue, 12000);
      expect(inv.returnsPercent, 20);
      expect(inv.isProfit, isTrue);
    });

    test('a losing position is not reported as a profit', () {
      final inv = InvestmentModel.fromJson({...holding, 'pnlPercent': -15});

      expect(inv.returnsPercent, -15);
      expect(inv.isProfit, isFalse);
    });

    test('derives values from quantity and price when totals are absent', () {
      final row = Map<String, dynamic>.from(holding)
        ..remove('totalCost')
        ..remove('currentValue')
        ..remove('pnlPercent');

      final inv = InvestmentModel.fromJson(row);

      expect(inv.investedValue, 10000);
      expect(inv.currentValue, 12000);
      expect(inv.returnsPercent, closeTo(20, 1e-9));
    });

    test('a zero-cost holding yields a finite return, never NaN', () {
      final inv = InvestmentModel.fromJson({
        'id': 'i2',
        'symbol': 'X',
        'quantity': 0,
        'averageBuyPrice': 0,
        'currentPrice': 0,
      });

      expect(inv.investedValue, 0.0);
      expect(inv.currentValue, 0.0);
      expect(inv.returnsPercent.isFinite, isTrue);
      expect(inv.returnsPercent, 0.0);
    });
  });

  group('budget percentage, remaining and over-budget', () {
    BudgetModel budget(Map<String, dynamic> overrides) => BudgetModel.fromJson({
      'id': 'b1',
      'categoryName': 'Food & Dining',
      'monthlyLimit': 12000,
      'spent': 3000,
      'month': 10,
      'year': 2026,
      ...overrides,
    });

    test('computes usage, remaining and not-yet-over', () {
      final b = budget({});

      expect(b.percentage, closeTo(0.25, 1e-9));
      expect(b.remaining, 9000);
      expect(b.isOverBudget, isFalse);
    });

    test('an absent spend is a real zero', () {
      final b = budget({'spent': null});

      expect(b.spent, 0.0);
      expect(b.remaining, 12000);
    });

    test('spending past the limit is flagged and clamped for display', () {
      final b = budget({'spent': 15000});

      expect(b.isOverBudget, isTrue);
      expect(b.percentage, 1.0);
      expect(b.remaining, -3000);
    });

    test('a zero limit never divides by zero', () {
      final b = budget({'monthlyLimit': 0});

      expect(b.percentage, 0.0);
      expect(b.isOverBudget, isTrue);
    });
  });

  group('goal progress and completion', () {
    GoalModel goal(Map<String, dynamic> overrides) => GoalModel.fromJson({
      'id': 'g1',
      'name': 'Emergency Fund',
      'targetAmount': 500000,
      'currentAmount': 120000,
      ...overrides,
    });

    test('computes progress without declaring an early win', () {
      final g = goal({});

      expect(g.progress, closeTo(0.24, 1e-9));
      expect(g.isAchieved, isFalse);
    });

    test('a reached target is complete and progress is capped at 1.0', () {
      expect(goal({'currentAmount': 500000}).isAchieved, isTrue);
      expect(goal({'currentAmount': 600000}).progress, 1.0);
    });

    test('a zero target never divides by zero', () {
      final g = goal({'targetAmount': 0, 'currentAmount': 0});

      expect(g.progress, 0.0);
      expect(g.isAchieved, isTrue);
    });

    test('a missing current amount is rejected rather than read as zero', () {
      expect(
        () => GoalModel.fromJson({
          'id': 'g1',
          'name': 'Emergency Fund',
          'targetAmount': 500000,
        }),
        throwsA(isA<ModelParseException>()),
      );
    });
  });
}
