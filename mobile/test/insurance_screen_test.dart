import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:finpro_mobile/core/api/api_client.dart';
import 'package:finpro_mobile/features/insurance/insurance_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Serves the three endpoints the screen combines, and lets a test fail any
/// subset of them so the "advisory review must not block the page" behaviour
/// can be verified.
class _InsuranceAdapter implements HttpClientAdapter {
  _InsuranceAdapter() {
    policies = [
      {
        'id': 'pol-1',
        'policyName': 'HDFC Life Secure',
        'insurer': 'HDFC Life',
        'policyType': 'LIFE',
        'coverageAmount': 5000000,
        'premium': 12000,
        'premiumCycle': 'ANNUAL',
        'renewalDate': '2027-03-15T00:00:00.000Z',
        'isActive': true,
      },
      {
        'id': 'pol-2',
        'policyName': 'Star Health Family',
        'insurer': 'Star Health',
        'policyType': 'HEALTH',
        'coverageAmount': 1000000,
        'premium': 1500,
        'premiumCycle': 'MONTHLY',
        'renewalDate': '2026-11-01T00:00:00.000Z',
        'isActive': true,
      },
    ];
    subscriptions = [
      {
        'id': 'sub-1',
        'serviceName': 'Netflix Premium',
        'cost': 649,
        'billingCycle': 'MONTHLY',
        'nextBillingDate': '2026-11-05T00:00:00.000Z',
        'category': 'Entertainment',
        'isActive': true,
      },
    ];
  }

  late List<Map<String, dynamic>> policies;
  late List<Map<String, dynamic>> subscriptions;

  /// Endpoint suffixes that should answer 500 instead of data.
  final Set<String> failPaths = {};

  int deleteRequests = 0;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final path = options.uri.path;

    if (options.method == 'DELETE') {
      deleteRequests++;
      final id = path.split('/').last;
      policies = policies.where((p) => p['id'] != id).toList();
      subscriptions = subscriptions.where((s) => s['id'] != id).toList();
      return _json(200, {
        'success': true,
        'data': {'message': 'Deleted.'},
      });
    }

    // Ordered so `/ai/insurance-review` is not swallowed by `/insurance`.
    if (path.endsWith('/ai/insurance-review')) {
      if (failPaths.contains('review')) {
        return _json(500, {'success': false, 'message': 'ai unavailable'});
      }
      return _json(200, {
        'success': true,
        'data': {
          'formattedTotalLifeCover': '₹50,00,000',
          'formattedTotalHealthCover': '₹10,00,000',
          'recommendations': [
            'Health cover is below the ₹5,00,000 benchmark.',
          ],
          'disclaimer': 'Automated estimate, not financial advice.',
        },
      });
    }

    if (path.endsWith('/subscriptions')) {
      if (failPaths.contains('subscriptions')) {
        return _json(500, {'success': false, 'message': 'server error'});
      }
      return _json(200, {
        'success': true,
        'data': {
          'subscriptions': subscriptions,
          'summary': {
            'totalSubscriptions': subscriptions.length,
            'activeSubscriptions': subscriptions.length,
            'monthlyTotal': 649,
            'formattedMonthlyTotal': '₹649',
            'annualTotal': 7788,
            'formattedAnnualTotal': '₹7,788',
          },
        },
      });
    }

    if (path.endsWith('/insurance')) {
      if (failPaths.contains('insurance')) {
        return _json(500, {'success': false, 'message': 'server error'});
      }
      return _json(200, {
        'success': true,
        'data': {
          'policies': policies,
          'summary': {
            'totalPolicies': policies.length,
            'activePolicies': policies.length,
            'totalCoverage': 6000000,
            'formattedTotalCoverage': '₹60,00,000',
            'annualPremium': 30000,
            'formattedAnnualPremium': '₹30,000',
            'nextRenewal': '2026-11-01T00:00:00.000Z',
          },
        },
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

  late _InsuranceAdapter adapter;
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
    adapter = _InsuranceAdapter();
    apiClient.dio.httpClientAdapter = adapter;
  });

  /// Bounded frame budget: the loading skeleton repeats forever, so a settle
  /// would never return while the first load is in flight.
  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 40; i++) {
      await tester.pump(const Duration(milliseconds: 20));
    }
  }

  Future<void> pumpScreen(WidgetTester tester) async {
    tester.view.physicalSize = const Size(900, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
    await tester.pumpWidget(const MaterialApp(home: InsuranceScreen()));
    await settle(tester);
  }

  testWidgets('renders the server totals plus both record sections', (
    tester,
  ) async {
    await pumpScreen(tester);

    expect(find.text('Insurance & Recurring'), findsOneWidget);

    // Headline figures come from the server's own summary block, so they match
    // the web page exactly rather than being reformatted on the client.
    // `SummaryHeroCard` upper-cases its label.
    expect(find.text('TOTAL COVERAGE'), findsOneWidget);
    expect(find.text('₹60,00,000'), findsOneWidget);
    expect(
      find.text('2 policies · ₹30,000 annual premium'),
      findsOneWidget,
    );

    expect(find.text('2 of 2 active'), findsOneWidget);
    expect(find.text('1 of 1 active'), findsOneWidget);
    expect(find.text('₹649 / month'), findsOneWidget);
    expect(find.text('₹7,788 / year'), findsOneWidget);

    expect(find.text('HDFC Life Secure'), findsOneWidget);
    expect(find.text('Star Health Family'), findsOneWidget);
    expect(find.text('Netflix Premium'), findsOneWidget);

    // The advisory review is rules-based and rendered as its own card.
    expect(find.text('Coverage Review'), findsOneWidget);
    expect(
      find.text('Health cover is below the ₹5,00,000 benchmark.'),
      findsOneWidget,
    );
    expect(
      find.text('Automated estimate, not financial advice.'),
      findsOneWidget,
    );
  });

  testWidgets('a failing advisory review never hides the underlying records', (
    tester,
  ) async {
    adapter.failPaths.add('review');
    await pumpScreen(tester);

    expect(find.text('Coverage Review'), findsNothing);
    expect(find.text('HDFC Life Secure'), findsOneWidget);
    expect(find.text('Netflix Premium'), findsOneWidget);
  });

  testWidgets('a failed core request shows the error state, not stale data', (
    tester,
  ) async {
    adapter.failPaths.add('insurance');
    await pumpScreen(tester);

    expect(find.text('Could not load data'), findsOneWidget);
    expect(find.text('HDFC Life Secure'), findsNothing);

    adapter.failPaths.clear();
    await tester.tap(find.text('Try Again'));
    await settle(tester);

    expect(find.text('HDFC Life Secure'), findsOneWidget);
  });

  testWidgets('deleting a policy confirms, calls DELETE and refreshes', (
    tester,
  ) async {
    await pumpScreen(tester);

    await tester.tap(find.byTooltip('Policy options').first);
    await settle(tester);

    await tester.tap(find.text('Delete policy'));
    await settle(tester);

    expect(
      find.textContaining('Remove "HDFC Life Secure" from your records?'),
      findsOneWidget,
    );
    await tester.tap(find.text('Delete'));
    await settle(tester);

    expect(adapter.deleteRequests, 1);
    expect(find.text('HDFC Life Secure'), findsNothing);
    expect(find.text('Star Health Family'), findsOneWidget);
    expect(find.text('Netflix Premium'), findsOneWidget);
  });

  testWidgets('empty records show guidance instead of a bare page', (
    tester,
  ) async {
    adapter.policies = [];
    adapter.subscriptions = [];

    await pumpScreen(tester);

    expect(
      find.textContaining('No policies recorded yet'),
      findsOneWidget,
    );
    expect(
      find.textContaining('No subscriptions tracked'),
      findsOneWidget,
    );
    expect(find.text('0 of 0 active'), findsNWidgets(2));
  });
}
