import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:finpro_mobile/core/api/api_client.dart';
import 'package:finpro_mobile/features/calendar/calendar_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Serves the two flavours of calendar row the backend returns in one list:
/// a user-created event (mutable) and one derived from a loan (read-only).
class _CalendarAdapter implements HttpClientAdapter {
  _CalendarAdapter() {
    events = [
      {
        'id': 'evt-1',
        'title': 'Pay Credit Card Bill',
        'description': 'Due this week',
        'type': 'REMINDER',
        'date': _localIso(5),
        'amount': 5000,
        'formattedAmount': '₹5,000',
        'color': '#4F46E5',
      },
      {
        'id': 'loan-1-emi',
        'title': 'HOME Loan EMI Due',
        'description': 'Monthly EMI: ₹45,000',
        'type': 'EMI',
        'date': _localIso(5),
        'amount': 45000,
        'formattedAmount': '₹45,000',
        'color': '#EF4444',
      },
    ];
  }

  late List<Map<String, dynamic>> events;

  bool failNext = false;
  int getRequests = 0;
  int createRequests = 0;
  int deleteRequests = 0;

  /// The API treats these columns as calendar dates. Serialising a *local*
  /// `DateTime` (no trailing `Z`) keeps `DateTime.parse` on the client in the
  /// same timezone, so the day a test asserts on does not shift with the
  /// machine's offset.
  static String _localIso(int day) {
    final now = DateTime.now();
    return DateTime(now.year, now.month, day, 9).toIso8601String();
  }

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final path = options.uri.path;

    if (options.method == 'GET' && path.endsWith('/calendar/events')) {
      getRequests++;
      if (failNext) {
        return _json(500, {'success': false, 'message': 'server error'});
      }
      return _json(200, {
        'success': true,
        'data': {'month': 1, 'year': 2000, 'events': events},
      });
    }

    if (options.method == 'POST' && path.endsWith('/calendar/events')) {
      createRequests++;
      return _json(201, {
        'success': true,
        'data': {'id': 'evt-new', 'message': 'Event created!'},
      });
    }

    if (options.method == 'DELETE' && path.contains('/calendar/events/')) {
      deleteRequests++;
      final id = path.split('/').last;
      events = events.where((e) => e['id'] != id).toList();
      return _json(200, {
        'success': true,
        'data': {'message': 'Event deleted.'},
      });
    }

    return _json(404, {'success': false, 'message': 'not found'});
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

  late _CalendarAdapter adapter;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
    adapter = _CalendarAdapter();
    apiClient.dio.httpClientAdapter = adapter;
  });

  /// Advances a bounded number of frames instead of `pumpAndSettle`.
  ///
  /// The skeleton placeholder runs a `repeat()`ing shimmer, so a settle never
  /// returns while the first load is in flight. A fixed frame budget lets the
  /// request resolve and the sheet/dialog transitions finish without risking a
  /// hang or a timeout.
  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 15; i++) {
      await tester.pump(const Duration(milliseconds: 20));
    }
  }

  /// Pumps the screen on a tall surface. The default 800x600 test window clips
  /// the month grid and the event list, so rows below the fold are never built
  /// by the lazy list and the finders below would see nothing.
  Future<void> pumpCalendar(WidgetTester tester) async {
    tester.view.physicalSize = const Size(900, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
    await tester.pumpWidget(const MaterialApp(home: CalendarScreen()));
    await settle(tester);
  }

  testWidgets('lists events and only offers delete on user-created ones', (
    tester,
  ) async {
    await pumpCalendar(tester);

    expect(find.text('Pay Credit Card Bill'), findsOneWidget);
    expect(find.text('HOME Loan EMI Due'), findsOneWidget);

    // Amounts come from the server's formatted strings, matching the web page.
    expect(find.text('₹5,000'), findsOneWidget);
    expect(find.text('₹45,000'), findsOneWidget);

    // Type codes are humanised without mangling acronyms.
    expect(find.text('Reminder'), findsOneWidget);
    expect(find.text('EMI'), findsOneWidget);

    // One mutable event, therefore exactly one options menu.
    expect(find.byType(PopupMenuButton<String>), findsOneWidget);
  });

  testWidgets('selecting a quiet day filters the list back to empty', (
    tester,
  ) async {
    await pumpCalendar(tester);

    // Every event sits on the 5th, so tapping any other day has nothing to show.
    await tester.tap(find.text('1'));
    await settle(tester);

    expect(find.text('Nothing scheduled on this day'), findsOneWidget);
    expect(find.text('Pay Credit Card Bill'), findsNothing);

    await tester.tap(find.text('Show all'));
    await settle(tester);

    expect(find.text('Pay Credit Card Bill'), findsOneWidget);
    expect(find.text('Nothing scheduled on this day'), findsNothing);
  });

  testWidgets('a failed load shows the error state instead of stale rows', (
    tester,
  ) async {
    adapter.failNext = true;

    await pumpCalendar(tester);

    expect(find.text('Could not load data'), findsOneWidget);
    expect(find.text('Pay Credit Card Bill'), findsNothing);

    // Retrying after the failure recovers the list.
    adapter.failNext = false;
    await tester.tap(find.text('Try Again'));
    await settle(tester);

    expect(find.text('Pay Credit Card Bill'), findsOneWidget);
  });

  testWidgets('deleting a custom event confirms, calls DELETE and refreshes', (
    tester,
  ) async {
    await pumpCalendar(tester);

    await tester.tap(find.byType(PopupMenuButton<String>));
    await settle(tester);

    await tester.tap(find.text('Delete event'));
    await settle(tester);

    expect(find.textContaining('Remove "Pay Credit Card Bill"'), findsOneWidget);
    await tester.tap(find.text('Delete'));
    await settle(tester);

    expect(adapter.deleteRequests, 1);
    expect(find.text('Pay Credit Card Bill'), findsNothing);
    // The derived row is untouched.
    expect(find.text('HOME Loan EMI Due'), findsOneWidget);
  });

  testWidgets('the add-event sheet validates the title before posting', (
    tester,
  ) async {
    await pumpCalendar(tester);

    await tester.tap(find.text('Add'));
    await settle(tester);

    expect(find.text('Add Calendar Event'), findsOneWidget);

    await tester.tap(find.text('Save Event'));
    await settle(tester);

    expect(find.text('Give the event a title.'), findsOneWidget);
    expect(adapter.createRequests, 0);
  });
}
