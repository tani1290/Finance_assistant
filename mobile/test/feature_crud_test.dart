import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:finpro_mobile/core/api/api_client.dart';
import 'package:finpro_mobile/features/accounts/accounts_screen.dart';
import 'package:finpro_mobile/features/budgets/budgets_screen.dart';
import 'package:finpro_mobile/features/goals/goals_screen.dart';
import 'package:finpro_mobile/features/investments/investments_screen.dart';
import 'package:finpro_mobile/features/loans/loans_screen.dart';
import 'package:finpro_mobile/features/notifications/notifications_screen.dart';
import 'package:finpro_mobile/features/transactions/transaction_detail_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Payloads below are copied from the backend controllers, not invented to
/// match the mobile models, so a green test means the real wire shape parses.
const _budgetsEnvelope = {
  'success': true,
  'data': {
    'month': 10,
    'year': 2026,
    'budgets': [
      {
        'id': 'b1',
        'categoryId': 'c1',
        'categoryName': 'Food & Dining',
        'monthlyLimit': 12000,
        'spent': 3000,
        'month': 10,
        'year': 2026,
      },
      {
        'id': 'b2',
        'categoryId': 'c2',
        'categoryName': 'Groceries',
        'monthlyLimit': 13000,
        'spent': 6000,
        'month': 10,
        'year': 2026,
      },
    ],
    'summary': {'totalBudgeted': 25000, 'totalSpent': 9000},
  },
};

const _goalsList = [
  {
    'id': 'g1',
    'name': 'Emergency Fund',
    'goalType': 'SAVINGS',
    'targetAmount': 500000,
    'currentAmount': 120000,
    'remaining': 380000,
    'progress': 24,
    'targetDate': '2027-06-01T00:00:00.000Z',
  },
];

const _loansEnvelope = {
  'success': true,
  'data': {
    'totalOutstanding': 1500000,
    'totalMonthlyEMI': 17356,
    'loans': [
      {
        'id': 'l1',
        'loanType': 'HOME',
        'lenderName': 'HDFC Bank',
        'principalAmount': 2000000,
        'interestRate': 8.5,
        'tenureMonths': 240,
        'startDate': '2020-01-01T00:00:00.000Z',
        'emiAmount': 17356,
        'outstandingBalance': 1500000,
        'status': 'ACTIVE',
      },
    ],
  },
};

const _portfolioEnvelope = {
  'success': true,
  'data': {
    'totalInvested': 100000,
    'currentValue': 120000,
    'totalPnl': 20000,
    'totalPnlPercent': 20,
    'holdings': [
      {
        'id': 'i1',
        'symbol': 'RELIANCE',
        'name': 'Reliance Industries',
        'assetType': 'STOCK',
        'quantity': 10,
        'averageBuyPrice': 1000,
        'currentPrice': 1200,
        'totalCost': 10000,
        'currentValue': 12000,
        'pnl': 2000,
        'pnlPercent': 20,
      },
    ],
  },
};

const _accountsEnvelope = {
  'success': true,
  'data': {
    'totalBalance': 52000,
    'accounts': [
      {
        'id': 'a1',
        'name': 'HDFC Savings',
        'institution': 'HDFC',
        'accountType': 'SAVINGS',
        'accountNumberMasked': '1234',
        'balance': 50000,
        'currency': 'INR',
        'isActive': true,
      },
      {
        'id': 'a2',
        'name': 'Paytm',
        'institution': 'Paytm',
        'accountType': 'CASH_WALLET',
        'accountNumberMasked': null,
        'balance': 1500,
        'currency': 'INR',
        'isActive': true,
      },
      {
        'id': 'a3',
        'name': 'Purse',
        'institution': null,
        'accountType': 'CASH_IN_HAND',
        'accountNumberMasked': null,
        'balance': 500,
        'currency': 'INR',
        'isActive': true,
      },
    ],
  },
};

const _notificationsList = [
  {
    'id': 'n1',
    'title': 'Budget Alert',
    'message': 'You have crossed 90% of your dining budget.',
    'type': 'WARNING',
    'isRead': false,
    'createdAt': '2026-10-15T09:30:00.000Z',
  },
];

/// The transaction detail endpoint spreads the raw row and adds a formatted
/// amount, exactly as the backend controller returns it.
const _transactionDetail = {
  'id': 't1',
  'accountId': 'a1',
  'categoryId': 'c1',
  'amount': 120.5,
  'transactionType': 'EXPENSE',
  'description': 'Lunch',
  'merchant': 'Cafe Coffee Day',
  'date': '2026-10-15T09:30:00.000Z',
  'currency': 'INR',
  'formattedAmount': '₹120.50',
  'category': {'id': 'c1', 'name': 'Food & Dining'},
  'account': {'id': 'a1', 'name': 'HDFC Savings'},
};

class _CrudAdapter implements HttpClientAdapter {
  final List<RequestOptions> requests = [];

  /// Controls the `POST /loans` reply so validation failures can be exercised.
  int loanPostStatus = 201;
  String loanPostError =
      'Principal amount, interest rate, and tenure are required.';

  /// Controls the `POST /goals` and contribute replies so rejected writes can
  /// be exercised without inventing a different wire shape.
  int goalPostStatus = 201;
  String goalPostError = 'A goal with this name already exists.';
  int goalContributeStatus = 200;
  String goalContributeError =
      'Contribution exceeds the remaining amount for this goal.';

  /// Controls every `DELETE` reply so a rejected removal can be exercised.
  int deleteStatus = 200;
  String deleteError = 'This item can no longer be removed.';

  Iterable<RequestOptions> _match(String method, String suffix) => requests
      .where((r) => r.method.toUpperCase() == method && r.uri.path.endsWith(suffix));

  int count(String method, String suffix) => _match(method, suffix).length;

  RequestOptions? last(String method, String suffix) {
    final matches = _match(method, suffix).toList();
    return matches.isEmpty ? null : matches.last;
  }

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    final method = options.method.toUpperCase();
    final path = options.uri.path;

    if (method == 'GET' && path.endsWith('/budgets')) {
      return _json(200, _budgetsEnvelope);
    }
    if (method == 'POST' && path.endsWith('/budgets')) {
      return _json(201, {
        'success': true,
        'data': {'id': 'b9', 'message': 'Budget created successfully.'},
      });
    }
    if (method == 'GET' && path.endsWith('/goals')) {
      return _json(200, {'success': true, 'data': _goalsList});
    }
    if (method == 'POST' && path.endsWith('/goals')) {
      if (goalPostStatus >= 400) {
        return _json(goalPostStatus, {
          'success': false,
          'error': {'code': 'VALIDATION_ERROR', 'message': goalPostError},
        });
      }
      return _json(201, {
        'success': true,
        'data': {'id': 'g9', 'message': 'Goal created successfully.'},
      });
    }
    if (method == 'PATCH' && path.endsWith('/contribute')) {
      if (goalContributeStatus >= 400) {
        return _json(goalContributeStatus, {
          'success': false,
          'error': {
            'code': 'VALIDATION_ERROR',
            'message': goalContributeError,
          },
        });
      }
      return _json(200, {
        'success': true,
        'data': {'message': 'Contribution added successfully.'},
      });
    }
    if (method == 'GET' && RegExp(r'/transactions/[^/]+$').hasMatch(path)) {
      return _json(200, {'success': true, 'data': _transactionDetail});
    }
    if (method == 'GET' && path.endsWith('/loans')) {
      return _json(200, _loansEnvelope);
    }
    if (method == 'POST' && path.endsWith('/loans')) {
      if (loanPostStatus >= 400) {
        return _json(loanPostStatus, {
          'success': false,
          'error': {'code': 'VALIDATION_ERROR', 'message': loanPostError},
        });
      }
      return _json(201, {
        'success': true,
        'data': {'id': 'l9', 'message': 'Loan added successfully.'},
      });
    }
    if (method == 'GET' && path.endsWith('/investments/portfolio')) {
      return _json(200, _portfolioEnvelope);
    }
    if (method == 'POST' && path.endsWith('/investments/buy')) {
      return _json(201, {
        'success': true,
        'data': {'id': 'i9', 'message': 'Successfully bought 10 units.'},
      });
    }
    if (method == 'POST' && path.endsWith('/accounts')) {
      return _json(201, {
        'success': true,
        'data': {'id': 'a9', 'message': 'Account added successfully.'},
      });
    }
    if (method == 'GET' && path.endsWith('/accounts')) {
      return _json(200, _accountsEnvelope);
    }
    if (method == 'GET' && path.endsWith('/notifications')) {
      return _json(200, {'success': true, 'data': _notificationsList});
    }
    if (method == 'POST' && path.endsWith('/notifications/read-all')) {
      return _json(200, {
        'success': true,
        'data': {'updated': 1, 'message': 'All notifications marked as read.'},
      });
    }
    if (method == 'PATCH' && path.contains('/notifications/')) {
      return _json(200, {
        'success': true,
        'data': {'message': 'Notification marked as read.'},
      });
    }
    if (method == 'DELETE') {
      if (deleteStatus >= 400) {
        return _json(deleteStatus, {
          'success': false,
          'error': {'code': 'CONFLICT', 'message': deleteError},
        });
      }
      return _json(200, {
        'success': true,
        'data': {'message': 'Deleted successfully.'},
      });
    }

    return _json(200, {'success': true, 'data': {}});
  }

  ResponseBody _json(int statusCode, Object body) {
    return ResponseBody.fromString(
      jsonEncode(body),
      statusCode,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

Map<String, dynamic> _bodyOf(RequestOptions request) =>
    Map<String, dynamic>.from(request.data as Map);

Future<void> _pump(WidgetTester tester, Widget screen) async {
  tester.view.physicalSize = const Size(1200, 2600);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(home: screen));
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _CrudAdapter adapter;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
    adapter = _CrudAdapter();
    apiClient.dio.httpClientAdapter = adapter;
  });

  testWidgets('budgets screen reads the data.budgets envelope', (tester) async {
    await _pump(tester, const BudgetsScreen());

    expect(find.text('Food & Dining'), findsOneWidget);
    expect(find.text('Groceries'), findsOneWidget);
    expect(find.text('This month'), findsOneWidget);
  });

  testWidgets('creating a budget posts category and limit then refreshes', (
    tester,
  ) async {
    await _pump(tester, const BudgetsScreen());
    expect(adapter.count('GET', '/budgets'), 1);

    await tester.tap(find.text('Add'));
    await tester.pumpAndSettle();

    final fields = find.byType(TextField);
    await tester.enterText(fields.at(0), 'Shopping');
    await tester.enterText(fields.at(1), '5000');
    await tester.ensureVisible(find.text('Save Budget'));
    await tester.tap(find.text('Save Budget'));
    await tester.pumpAndSettle();

    final post = adapter.last('POST', '/budgets');
    expect(post, isNotNull);
    expect(_bodyOf(post!), {'categoryName': 'Shopping', 'monthlyLimit': 5000.0});
    // The list is re-fetched after a successful create.
    expect(adapter.count('GET', '/budgets'), 2);
  });

  testWidgets('deleting a budget requires confirmation then calls the item URL', (
    tester,
  ) async {
    await _pump(tester, const BudgetsScreen());

    await tester.tap(find.byTooltip('Budget options').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delete budget'));
    await tester.pumpAndSettle();

    expect(find.text('Delete budget?'), findsOneWidget);
    await tester.tap(find.widgetWithText(TextButton, 'Delete'));
    await tester.pumpAndSettle();

    expect(adapter.last('DELETE', '/budgets/b1'), isNotNull);
    expect(adapter.count('GET', '/budgets'), 2);
  });

  testWidgets('deleting a goal confirms then calls DELETE /goals/:id', (
    tester,
  ) async {
    await _pump(tester, const GoalsScreen());
    expect(find.text('Emergency Fund'), findsOneWidget);

    await tester.tap(find.byTooltip('Goal options').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delete goal'));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(TextButton, 'Delete'));
    await tester.pumpAndSettle();

    expect(adapter.last('DELETE', '/goals/g1'), isNotNull);
  });

  testWidgets('a rejected loan shows the backend validation message', (
    tester,
  ) async {
    adapter.loanPostStatus = 400;
    await _pump(tester, const LoansScreen());

    await tester.tap(find.text('Add'));
    await tester.pumpAndSettle();

    final fields = find.byType(TextField);
    await tester.enterText(fields.at(1), '500000');
    await tester.enterText(fields.at(2), '9.5');
    await tester.enterText(fields.at(3), '60');
    await tester.ensureVisible(find.text('Save Loan'));
    await tester.tap(find.text('Save Loan'));
    await tester.pumpAndSettle();

    expect(adapter.last('POST', '/loans'), isNotNull);
    expect(find.text(adapter.loanPostError), findsOneWidget);
    // The sheet stays open so the user can correct the input.
    expect(find.text('Add Loan'), findsOneWidget);
  });

  testWidgets('creating a loan posts the required fields and refreshes', (
    tester,
  ) async {
    await _pump(tester, const LoansScreen());
    expect(adapter.count('GET', '/loans'), 1);

    await tester.tap(find.text('Add'));
    await tester.pumpAndSettle();

    final fields = find.byType(TextField);
    await tester.enterText(fields.at(0), 'ICICI');
    await tester.enterText(fields.at(1), '250000');
    await tester.enterText(fields.at(2), '11');
    await tester.enterText(fields.at(3), '36');
    await tester.ensureVisible(find.text('Save Loan'));
    await tester.tap(find.text('Save Loan'));
    await tester.pumpAndSettle();

    final body = _bodyOf(adapter.last('POST', '/loans')!);
    expect(body['loanType'], 'PERSONAL');
    expect(body['lenderName'], 'ICICI');
    expect(body['principalAmount'], 250000.0);
    expect(body['interestRate'], 11.0);
    expect(body['tenureMonths'], 36);
    expect(adapter.count('GET', '/loans'), 2);
  });

  testWidgets('deleting a loan confirms then calls DELETE /loans/:id', (
    tester,
  ) async {
    await _pump(tester, const LoansScreen());

    await tester.tap(find.byTooltip('Loan options').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delete loan'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Delete'));
    await tester.pumpAndSettle();

    expect(adapter.last('DELETE', '/loans/l1'), isNotNull);
  });

  testWidgets('buying an investment posts the purchase payload', (
    tester,
  ) async {
    await _pump(tester, const InvestmentsScreen());
    expect(adapter.count('GET', '/investments/portfolio'), 1);

    await tester.tap(find.text('Buy'));
    await tester.pumpAndSettle();

    final fields = find.byType(TextField);
    await tester.enterText(fields.at(0), 'reliance');
    await tester.enterText(fields.at(2), '10');
    await tester.enterText(fields.at(3), '2450.50');
    await tester.ensureVisible(find.text('Record Purchase'));
    await tester.tap(find.text('Record Purchase'));
    await tester.pumpAndSettle();

    final body = _bodyOf(adapter.last('POST', '/investments/buy')!);
    expect(body['symbol'], 'RELIANCE');
    expect(body['assetType'], 'STOCK');
    expect(body['quantity'], 10.0);
    expect(body['buyPrice'], 2450.5);
    expect(adapter.count('GET', '/investments/portfolio'), 2);
  });

  testWidgets('removing a holding confirms then calls DELETE /investments/:id', (
    tester,
  ) async {
    await _pump(tester, const InvestmentsScreen());

    await tester.tap(find.byTooltip('Holding options').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Remove holding'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Remove'));
    await tester.pumpAndSettle();

    expect(adapter.last('DELETE', '/investments/i1'), isNotNull);
  });

  testWidgets('removing an account confirms then calls DELETE /accounts/:id', (
    tester,
  ) async {
    await _pump(tester, const AccountsScreen());
    expect(find.text('HDFC Savings'), findsOneWidget);

    await tester.tap(find.byTooltip('Account options').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Remove account'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Remove'));
    await tester.pumpAndSettle();

    expect(adapter.last('DELETE', '/accounts/a1'), isNotNull);
  });

  testWidgets('cash categories render friendly labels', (tester) async {
    await _pump(tester, const AccountsScreen());

    expect(find.textContaining('Cash Wallet'), findsOneWidget);
    expect(find.textContaining('Cash in Hand'), findsOneWidget);
    expect(find.textContaining('CASH_WALLET'), findsNothing);
    expect(find.textContaining('CASH_IN_HAND'), findsNothing);
  });

  testWidgets('adding a cash-in-hand account posts CASH_IN_HAND and no mask', (
    tester,
  ) async {
    await _pump(tester, const AccountsScreen());

    await tester.tap(find.byTooltip('Add account'));
    await tester.pumpAndSettle();
    expect(find.text('Add Financial Account'), findsOneWidget);

    await tester.enterText(
      find.byKey(const ValueKey('account-name-field')),
      'Petty cash',
    );
    await tester.tap(find.byKey(const ValueKey('account-type-dropdown')));
    await tester.pumpAndSettle();
    final cashInHandItem =
        find.byKey(const ValueKey('account-type-CASH_IN_HAND'));
    await tester.ensureVisible(cashInHandItem);
    await tester.pumpAndSettle();
    await tester.tap(
      find.descendant(of: cashInHandItem, matching: find.byType(Text)),
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('account-balance-field')),
      '275.50',
    );

    await tester.tap(find.text('Save Account'));
    await tester.pumpAndSettle();

    final post = adapter.last('POST', '/accounts');
    expect(post, isNotNull);
    final body = _bodyOf(post!);
    expect(body['name'], 'Petty cash');
    expect(body['accountType'], 'CASH_IN_HAND');
    expect(body['balance'], 275.5);
    // Cash-like categories do not invent a bank account number.
    expect(body.containsKey('accountNumberMasked'), isFalse);
  });

  testWidgets('editing prefills the mask and PATCHes a new cash category', (
    tester,
  ) async {
    await _pump(tester, const AccountsScreen());

    await tester.tap(find.byTooltip('Account options').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Edit account'));
    await tester.pumpAndSettle();
    expect(find.text('Edit Financial Account'), findsOneWidget);

    final nameField = tester.widget<TextField>(
      find.byKey(const ValueKey('account-name-field')),
    );
    final maskedField = tester.widget<TextField>(
      find.byKey(const ValueKey('account-masked-field')),
    );
    expect(nameField.controller!.text, 'HDFC Savings');
    expect(maskedField.controller!.text, '1234');

    await tester.enterText(
      find.byKey(const ValueKey('account-name-field')),
      'HDFC Cash Wallet',
    );
    await tester.tap(find.byKey(const ValueKey('account-type-dropdown')));
    await tester.pumpAndSettle();
    final cashWalletItem =
        find.byKey(const ValueKey('account-type-CASH_WALLET'));
    await tester.ensureVisible(cashWalletItem);
    await tester.pumpAndSettle();
    await tester.tap(
      find.descendant(of: cashWalletItem, matching: find.byType(Text)),
    );
    await tester.pumpAndSettle();
    // Explicitly clearing the mask must be sent as '', not omitted, so the
    // backend knows to clear the stored value.
    await tester.enterText(
      find.byKey(const ValueKey('account-masked-field')),
      '',
    );
    await tester.enterText(
      find.byKey(const ValueKey('account-balance-field')),
      '51000',
    );

    await tester.tap(find.text('Save Changes'));
    await tester.pumpAndSettle();

    final patch = adapter.last('PATCH', '/accounts/a1');
    expect(patch, isNotNull);
    final body = _bodyOf(patch!);
    expect(body['name'], 'HDFC Cash Wallet');
    expect(body['accountType'], 'CASH_WALLET');
    expect(body['accountNumberMasked'], '');
    expect(body['balance'], 51000);
  });

  testWidgets('a bank account still requires the last 4 digits', (
    tester,
  ) async {
    await _pump(tester, const AccountsScreen());

    await tester.tap(find.byTooltip('Add account'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('account-name-field')),
      'New bank',
    );
    await tester.enterText(
      find.byKey(const ValueKey('account-balance-field')),
      '1000',
    );
    await tester.tap(find.text('Save Account'));
    await tester.pumpAndSettle();

    expect(adapter.last('POST', '/accounts'), isNull);
    expect(
      find.text('Enter the last 4 digits of the account number.'),
      findsOneWidget,
    );
  });

  testWidgets('notifications mark all as read and delete a single item', (
    tester,
  ) async {
    await _pump(tester, const NotificationsScreen());
    expect(find.text('Budget Alert'), findsOneWidget);

    await tester.tap(find.byTooltip('Mark all as read'));
    await tester.pumpAndSettle();
    expect(adapter.last('POST', '/notifications/read-all'), isNotNull);

    await tester.tap(find.byTooltip('Notification options').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delete notification'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Delete'));
    await tester.pumpAndSettle();

    expect(adapter.last('DELETE', '/notifications/n1'), isNotNull);
  });

  testWidgets(
    'a rejected goal create shows the backend message and keeps the dialog open',
    (tester) async {
      adapter.goalPostStatus = 400;
      await _pump(tester, const GoalsScreen());

      await tester.tap(find.byIcon(Icons.add_rounded));
      await tester.pumpAndSettle();

      final fields = find.byType(TextField);
      await tester.enterText(fields.at(0), 'New Car');
      await tester.enterText(fields.at(1), '500000');
      await tester.tap(find.text('Create Goal'));
      await tester.pumpAndSettle();

      expect(adapter.last('POST', '/goals'), isNotNull);
      expect(find.text(adapter.goalPostError), findsOneWidget);
      // No success path ran: the dialog is still open and the list was not
      // refreshed as if the write had succeeded.
      expect(find.text('Add Savings Goal'), findsOneWidget);
      expect(adapter.count('GET', '/goals'), 1);
    },
  );

  testWidgets(
    'a rejected contribution shows the backend message and keeps the dialog open',
    (tester) async {
      adapter.goalContributeStatus = 400;
      await _pump(tester, const GoalsScreen());

      await tester.tap(find.text('Add Funds to Goal'));
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField).first, '1000');
      await tester.tap(find.text('Contribute'));
      await tester.pumpAndSettle();

      final patch = adapter.last('PATCH', '/contribute');
      expect(patch, isNotNull);
      expect(_bodyOf(patch!)['amount'], 1000.0);
      expect(find.text(adapter.goalContributeError), findsOneWidget);
      expect(adapter.count('GET', '/goals'), 1);
    },
  );

  testWidgets('a rejected goal delete shows the backend message', (
    tester,
  ) async {
    adapter.deleteStatus = 409;
    await _pump(tester, const GoalsScreen());

    await tester.tap(find.byTooltip('Goal options').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delete goal'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Delete'));
    await tester.pumpAndSettle();

    expect(find.text(adapter.deleteError), findsOneWidget);
    // The failed delete did not refresh the list as if it had succeeded.
    expect(adapter.count('GET', '/goals'), 1);
  });

  testWidgets(
    'a rejected transaction delete shows the backend message and stays on the screen',
    (tester) async {
      adapter.deleteStatus = 409;
      await _pump(
        tester,
        const TransactionDetailScreen(transactionId: 't1'),
      );

      expect(find.text('Transaction Details'), findsOneWidget);
      expect(find.text('Food & Dining'), findsOneWidget);

      await tester.tap(find.byIcon(Icons.delete_outline_rounded));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(ElevatedButton, 'Delete'));
      await tester.pumpAndSettle();

      expect(adapter.last('DELETE', '/transactions/t1'), isNotNull);
      expect(find.text(adapter.deleteError), findsOneWidget);
      // The screen was not popped and no success was reported.
      expect(find.text('Transaction Details'), findsOneWidget);
    },
  );
}
