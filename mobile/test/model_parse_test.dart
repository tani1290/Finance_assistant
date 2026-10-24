import 'package:finpro_mobile/core/models/account_model.dart';
import 'package:finpro_mobile/core/models/budget_model.dart';
import 'package:finpro_mobile/core/models/goal_model.dart';
import 'package:finpro_mobile/core/models/investment_model.dart';
import 'package:finpro_mobile/core/models/loan_model.dart';
import 'package:finpro_mobile/core/models/model_parse.dart';
import 'package:finpro_mobile/core/models/pending_sms_model.dart';
import 'package:finpro_mobile/core/models/transaction_model.dart';
import 'package:finpro_mobile/core/models/user_model.dart';
import 'package:flutter_test/flutter_test.dart';

/// A complete, valid transaction payload. Individual tests delete one key to
/// prove that the field is genuinely required.
Map<String, dynamic> _transactionJson() => {
  'id': 'txn-1',
  'amount': '120.50',
  'transactionType': 'EXPENSE',
  'date': '2026-10-10T10:00:00.000Z',
};

Map<String, dynamic> _accountJson() => {
  'id': 'acc-1',
  'name': 'Salary Account',
  'balance': 1000,
  'accountType': 'BANK',
};

Map<String, dynamic> _budgetJson() => {
  'id': 'bud-1',
  'monthlyLimit': 5000,
  'month': 10,
  'year': 2026,
};

Map<String, dynamic> _goalJson() => {
  'id': 'goal-1',
  'name': 'Emergency Fund',
  'targetAmount': 100000,
  'currentAmount': 25000,
};

Map<String, dynamic> _investmentJson() => {
  'id': 'inv-1',
  'symbol': 'INFY',
  'quantity': 10,
  'buyPrice': 1500,
};

Map<String, dynamic> _loanJson() => {
  'id': 'loan-1',
  'principalAmount': 500000,
  'outstandingAmount': 320000,
  'interestRate': 8.5,
  'emiAmount': 12500,
  'tenureMonths': 60,
};

Map<String, dynamic> _pendingJson() => {
  'id': 'sms-1',
  'amount': 450,
  'transactionType': 'EXPENSE',
  'transactionDate': '2026-10-10T10:00:00.000Z',
};

Map<String, dynamic> _userJson() => {'id': 'user-1', 'email': 'a@b.com'};

void main() {
  group('required-field rejection', () {
    test('TransactionModel rejects a missing id', () {
      final json = _transactionJson()..remove('id');
      expect(
        () => TransactionModel.fromJson(json),
        throwsA(isA<ModelParseException>()),
      );
    });

    test(
      'TransactionModel rejects a missing amount instead of defaulting 0',
      () {
        final json = _transactionJson()..remove('amount');
        expect(
          () => TransactionModel.fromJson(json),
          throwsA(isA<ModelParseException>()),
        );
      },
    );

    test('TransactionModel rejects an unparseable amount', () {
      final json = _transactionJson()..['amount'] = 'not-a-number';
      expect(
        () => TransactionModel.fromJson(json),
        throwsA(isA<ModelParseException>()),
      );
    });

    test('TransactionModel rejects a missing date instead of using now()', () {
      final json = _transactionJson()..remove('date');
      expect(
        () => TransactionModel.fromJson(json),
        throwsA(isA<ModelParseException>()),
      );
    });

    test('TransactionModel rejects a missing transactionType instead of '
        'guessing EXPENSE', () {
      final json = _transactionJson()..remove('transactionType');
      expect(
        () => TransactionModel.fromJson(json),
        throwsA(isA<ModelParseException>()),
      );
    });

    test('AccountModel rejects a missing balance', () {
      final json = _accountJson()..remove('balance');
      expect(
        () => AccountModel.fromJson(json),
        throwsA(isA<ModelParseException>()),
      );
    });

    test('BudgetModel rejects a missing month instead of using now()', () {
      final json = _budgetJson()..remove('month');
      expect(
        () => BudgetModel.fromJson(json),
        throwsA(isA<ModelParseException>()),
      );
    });

    test('GoalModel rejects a missing target amount', () {
      final json = _goalJson()..remove('targetAmount');
      expect(
        () => GoalModel.fromJson(json),
        throwsA(isA<ModelParseException>()),
      );
    });

    test('LoanModel rejects a missing outstanding amount', () {
      final json = _loanJson()..remove('outstandingAmount');
      expect(
        () => LoanModel.fromJson(json),
        throwsA(isA<ModelParseException>()),
      );
    });

    test('PendingSmsModel rejects a missing transaction date', () {
      final json = _pendingJson()..remove('transactionDate');
      expect(
        () => PendingSmsModel.fromJson(json),
        throwsA(isA<ModelParseException>()),
      );
    });

    test('UserModel rejects a missing id', () {
      final json = _userJson()..remove('id');
      expect(
        () => UserModel.fromJson(json),
        throwsA(isA<ModelParseException>()),
      );
    });

    test('UserModel rejects a missing email', () {
      final json = _userJson()..remove('email');
      expect(
        () => UserModel.fromJson(json),
        throwsA(isA<ModelParseException>()),
      );
    });

    test('GoalModel rejects a malformed optional targetDate', () {
      final json = _goalJson()..['targetDate'] = 'not-a-date';
      expect(
        () => GoalModel.fromJson(json),
        throwsA(isA<ModelParseException>()),
      );
    });
  });

  group('valid payloads still parse', () {
    test('numeric strings are accepted for amounts and ids', () {
      final transaction = TransactionModel.fromJson(_transactionJson());
      expect(transaction.id, 'txn-1');
      expect(transaction.amount, 120.50);
      expect(transaction.transactionType, 'EXPENSE');
    });

    test('an absent optional targetDate stays null', () {
      final goal = GoalModel.fromJson(_goalJson());
      expect(goal.targetDate, isNull);
      expect(goal.targetAmount, 100000);
    });

    test('InvestmentModel derives the value fields when omitted', () {
      final investment = InvestmentModel.fromJson(_investmentJson());
      expect(investment.quantity, 10);
      expect(investment.buyPrice, 1500);
      // currentPrice falls back to buyPrice, so the position is flat.
      expect(investment.currentPrice, 1500);
      expect(investment.investedValue, 15000);
      expect(investment.currentValue, 15000);
      expect(investment.returnsPercent, 0);
      expect(investment.name, 'INFY');
    });

    test('BudgetModel treats an absent spent as zero but keeps the limit', () {
      final budget = BudgetModel.fromJson(_budgetJson());
      expect(budget.spent, 0);
      expect(budget.monthlyLimit, 5000);
      expect(budget.month, 10);
      expect(budget.year, 2026);
    });
  });
}
