import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:finpro_mobile/core/api/api_client.dart';
import 'package:finpro_mobile/features/transactions/transactions_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _TransactionsAdapter implements HttpClientAdapter {
  bool failNext = false;
  int requests = 0;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests++;
    if (failNext) {
      return _json(500, {'success': false, 'message': 'server error'});
    }

    final page =
        int.tryParse(options.uri.queryParameters['page']?.toString() ?? '1') ??
        1;

    if (page == 1) {
      return _json(200, {
        'success': true,
        'data': {
          'transactions': [_transaction('t1', 'Cafe One')],
          'pagination': {'page': 1, 'limit': 20, 'total': 2, 'totalPages': 2},
        },
      });
    }

    return _json(200, {
      'success': true,
      'data': {
        'transactions': [_transaction('t2', 'Cafe Two')],
        'pagination': {'page': 2, 'limit': 20, 'total': 2, 'totalPages': 2},
      },
    });
  }

  Map<String, dynamic> _transaction(String id, String merchant) {
    // Mirrors GET /api/v1/transactions (flattened `type`, string `category`
    // and `account`), not the raw Prisma row the detail endpoint returns.
    return {
      'id': id,
      'amount': 120.50,
      'formattedAmount': '₹120.50',
      'type': 'EXPENSE',
      'category': 'Food & Dining',
      'account': 'HDFC Savings',
      'description': '',
      'merchant': merchant,
      'date': '2026-10-10T00:00:00.000Z',
      'currency': 'INR',
      'createdAt': '2026-10-10T10:00:00.000Z',
    };
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

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _TransactionsAdapter adapter;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
    adapter = _TransactionsAdapter();
    apiClient.dio.httpClientAdapter = adapter;
  });

  testWidgets('loads the next page and hides the footer at the last page', (
    tester,
  ) async {
    await tester.pumpWidget(const MaterialApp(home: TransactionsScreen()));
    await tester.pumpAndSettle();

    expect(find.text('Cafe One'), findsOneWidget);
    expect(find.text('Load more'), findsOneWidget);

    await tester.tap(find.text('Load more'));
    await tester.pumpAndSettle();

    expect(find.text('Cafe Two'), findsOneWidget);
    expect(find.text('Load more'), findsNothing);
  });

  testWidgets('a failed filter request shows an error instead of stale rows', (
    tester,
  ) async {
    await tester.pumpWidget(const MaterialApp(home: TransactionsScreen()));
    await tester.pumpAndSettle();

    expect(find.text('Cafe One'), findsOneWidget);

    adapter.failNext = true;
    await tester.tap(find.text('Expenses'));
    await tester.pumpAndSettle();

    expect(find.text('Cafe One'), findsNothing);
    expect(find.text('Could not load data'), findsOneWidget);
    expect(find.textContaining('HTTP 500'), findsOneWidget);
  });
}
