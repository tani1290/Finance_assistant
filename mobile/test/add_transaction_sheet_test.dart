import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:finpro_mobile/core/api/api_client.dart';
import 'package:finpro_mobile/features/transactions/add_transaction_sheet.dart';
import 'package:finpro_mobile/shared/widgets/gradient_button.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _accountsEnvelope = {
  'success': true,
  'data': {
    'totalBalance': 7000,
    'formattedTotalBalance': '₹7,000.00',
    'accounts': [
      {
        'id': 'a1',
        'name': 'HDFC Savings',
        'institution': 'HDFC',
        'accountType': 'SAVINGS',
        'accountNumberMasked': '1234',
        'balance': 5000,
        'currency': 'INR',
        'isActive': true,
      },
      {
        'id': 'a2',
        'name': 'ICICI Salary',
        'institution': 'ICICI',
        'accountType': 'SALARY',
        'accountNumberMasked': '5678',
        'balance': 2000,
        'currency': 'INR',
        'isActive': true,
      },
    ],
  },
};

class _TransactionAdapter implements HttpClientAdapter {
  final List<RequestOptions> requests = [];

  int postStatus = 201;

  List<RequestOptions> posts() => requests
      .where((r) => r.method.toUpperCase() == 'POST' &&
          r.uri.path.endsWith('/transactions'))
      .toList();

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);

    if (options.method.toUpperCase() == 'GET' &&
        options.uri.path.endsWith('/accounts')) {
      return _json(200, _accountsEnvelope);
    }

    if (options.method.toUpperCase() == 'POST' &&
        options.uri.path.endsWith('/transactions')) {
      if (postStatus >= 400) {
        return _json(postStatus, {
          'success': false,
          'error': {
            'code': 'SERVER_ERROR',
            'message': 'Transaction could not be saved.',
          },
        });
      }
      return _json(201, {
        'success': true,
        'data': {'message': 'Transaction created.'},
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

Future<void> _openSheet(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1200, 2600);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => ElevatedButton(
            onPressed: () => AddTransactionSheet.show(
              context,
              onCreated: (_) {},
            ),
            child: const Text('Open'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('Open'));
  await tester.pumpAndSettle();
}

Future<void> _fillTransfer(WidgetTester tester) async {
  await tester.tap(find.text('Transfer'));
  await tester.pumpAndSettle();

  final dropdowns = find.byType(DropdownButtonFormField<String?>);
  expect(dropdowns, findsNWidgets(2));

  await tester.tap(dropdowns.at(0));
  await tester.pumpAndSettle();
  await tester.tap(find.text('HDFC Savings').last);
  await tester.pumpAndSettle();

  await tester.tap(dropdowns.at(1));
  await tester.pumpAndSettle();
  await tester.tap(find.text('ICICI Salary').last);
  await tester.pumpAndSettle();

  await tester.enterText(find.byType(TextField).first, '250');
  await tester.pump();
}

Map<String, dynamic> _bodyOf(RequestOptions request) =>
    Map<String, dynamic>.from(request.data as Map);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _TransactionAdapter adapter;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
    adapter = _TransactionAdapter();
    apiClient.dio.httpClientAdapter = adapter;
  });

  testWidgets('a transfer retry after a failed response reuses its key', (
    tester,
  ) async {
    adapter.postStatus = 500;
    await _openSheet(tester);
    await _fillTransfer(tester);

    await tester.tap(find.byType(GradientButton));
    await tester.pumpAndSettle();
    expect(adapter.posts(), hasLength(1));
    final firstKey = _bodyOf(adapter.posts().first)['idempotencyKey'];
    expect(firstKey, isA<String>());
    expect((firstKey as String).length, greaterThanOrEqualTo(8));

    // Let the error SnackBar expire before retrying the same transfer.
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();

    adapter.postStatus = 201;
    await tester.tap(find.byType(GradientButton));
    await tester.pumpAndSettle();

    expect(adapter.posts(), hasLength(2));
    expect(_bodyOf(adapter.posts().last)['idempotencyKey'], firstKey);
  });

  testWidgets('a new sheet sends a new key and non-transfers send none', (
    tester,
  ) async {
    await _openSheet(tester);

    await tester.enterText(find.byType(TextField).first, '99');
    await tester.pump();
    await tester.tap(find.byType(GradientButton));
    await tester.pumpAndSettle();

    expect(adapter.posts(), hasLength(1));
    expect(_bodyOf(adapter.posts().first).containsKey('idempotencyKey'), isFalse);

    // A new sheet means a new logical transaction, so it gets a new key.
    await _openSheet(tester);
    await _fillTransfer(tester);
    await tester.tap(find.byType(GradientButton));
    await tester.pumpAndSettle();

    final transferBody = _bodyOf(adapter.posts().last);
    expect(transferBody['type'], 'TRANSFER');
    expect(transferBody['idempotencyKey'], isA<String>());
  });
}
