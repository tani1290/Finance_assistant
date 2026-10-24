import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:finpro_mobile/core/api/api_client.dart';
import 'package:finpro_mobile/core/auth/auth_notifier.dart';
import 'package:finpro_mobile/core/auth/auth_state.dart';
import 'package:finpro_mobile/core/models/analytics_models.dart';
import 'package:finpro_mobile/core/models/model_parse.dart';
import 'package:finpro_mobile/core/models/user_model.dart';
import 'package:finpro_mobile/features/accounts/accounts_screen.dart';
import 'package:finpro_mobile/features/analytics/analytics_screen.dart';
import 'package:finpro_mobile/features/profile/profile_screen.dart';
import 'package:finpro_mobile/shared/widgets/error_state_view.dart';
import 'package:finpro_mobile/shared/widgets/gradient_button.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Payloads mirror the real backend responses (analyticsEngine, authController,
/// accountController). They are copied from the controllers rather than shaped
/// to fit the models, so a green run means the real wire shape parses.

const _analyticsEnvelope = {
  'success': true,
  'data': {
    'period': 'month',
    'month': 10,
    'year': 2026,
    'summary': {
      'totalIncome': 90000,
      'formattedIncome': '₹90,000.00',
      'totalExpenses': 60000,
      'formattedExpenses': '₹60,000.00',
      'netSavings': 30000,
      'formattedNetSavings': '₹30,000.00',
      'savingsRate': 33,
      'incomeTransactions': 3,
      'expenseTransactions': 20,
    },
    'monthOverMonth': {
      'comparisonPeriod': 'September 2026',
      'incomeChange': {
        'previous': 80000,
        'current': 90000,
        'absoluteChange': 10000,
        'percentageChange': 12.5,
        'direction': 'up',
      },
      'expenseChange': {
        'previous': 55000,
        'current': 60000,
        'absoluteChange': 5000,
        'percentageChange': 9.09,
        'direction': 'up',
      },
      'netCashFlowChange': {
        'previous': 25000,
        'current': 30000,
        'absoluteChange': 5000,
        'percentageChange': 20,
        'direction': 'up',
      },
      'savings': {
        'previous': 25000,
        'current': 30000,
        'absoluteChange': 5000,
        'percentageChange': null,
        'direction': 'flat',
      },
      'savingsRateChange': 3.5,
    },
    'categoryBreakdown': [
      {
        'category': 'Food & Dining',
        'amount': 20000,
        'formattedAmount': '₹20,000.00',
        'percentage': 33,
      },
    ],
    'monthlyTrend': [
      {'date': '2026-10-01T00:00:00.000Z', 'amount': 30000},
    ],
    'dailyFlow': [
      {'date': '2026-10-01', 'income': 90000, 'expenses': 10000, 'net': 80000},
      {'date': '2026-10-02', 'income': 0, 'expenses': 50000, 'net': -50000},
    ],
  },
};

const _emptyAnalyticsEnvelope = {
  'success': true,
  'data': {
    'period': 'month',
    'month': 10,
    'year': 2026,
    'summary': {
      'totalIncome': 0,
      'formattedIncome': '₹0.00',
      'totalExpenses': 0,
      'formattedExpenses': '₹0.00',
      'netSavings': 0,
      'formattedNetSavings': '₹0.00',
      'savingsRate': 0,
      'incomeTransactions': 0,
      'expenseTransactions': 0,
    },
    'monthOverMonth': null,
    'categoryBreakdown': [],
    'monthlyTrend': [],
    'dailyFlow': [],
  },
};

const _forecastEnvelope = {
  'success': true,
  'data': {
    'valid': true,
    'method': 'average_daily_run_rate',
    'methodLabel': 'Average daily run rate',
    'isEstimate': true,
    'label': 'Estimated October 2026 spending',
    'insufficientData': false,
    'reason': null,
    'month': 10,
    'year': 2026,
    'daysInMonth': 31,
    'elapsedDays': 19,
    'remainingDays': 12,
    'spentSoFar': 60000,
    'formattedSpentSoFar': '₹60,000.00',
    'averageDailySpend': 3157.89,
    'formattedAverageDailySpend': '₹3,157.89',
    'projectedExpense': 97894.74,
    'formattedProjectedExpense': '₹97,894.74',
    'transactionCount': 20,
    'duplicatesExcluded': 0,
    'isCompleteMonth': false,
    'categories': [],
  },
};

const _insightsEnvelope = {
  'success': true,
  'data': {
    'month': 10,
    'year': 2026,
    'warningThreshold': 80,
    'insights': [
      {
        'type': 'CATEGORY_OVERSHARE',
        'severity': 'critical',
        'category': 'Food & Dining',
        'title': 'Food & Dining is your largest category',
        'explanation': "It accounts for 33% of this month's spending.",
        'isEstimate': false,
      },
      {
        'type': 'FORECAST_EXCEEDANCE',
        'severity': 'warning',
        'title': 'Spending is trending above last month',
        'explanation': 'The projected total is above September.',
        'isEstimate': true,
      },
    ],
  },
};

/// The `GET /auth/me` / `PATCH /auth/profile` shape produced by authController.
const _meData = {
  'id': 'u1',
  'email': 'aarav@example.com',
  'username': 'aarav',
  'firstName': 'Aarav',
  'lastName': 'Sharma',
  'phone': '9999999999',
  'avatarUrl': null,
  'role': 'USER',
  'isPremium': true,
  'currency': 'INR',
  'timezone': 'Asia/Kolkata',
  'country': 'India',
  'createdAt': '2025-01-15T00:00:00.000Z',
  'profile': {
    'occupation': 'Software Engineer',
    'bio': 'Building things.',
  },
  'financialProfile': {
    'city': 'Mumbai',
    'monthlySalary': 90000,
    'estimatedMonthlyExpenses': 60000,
    'riskProfile': 'MODERATE',
  },
};

/// Two accounts so the deposit sheet also renders its account selector.
const _accountsEnvelope = {
  'success': true,
  'data': {
    'totalBalance': 70000,
    'formattedTotalBalance': '₹70,000.00',
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
        'name': 'ICICI Salary',
        'institution': 'ICICI',
        'accountType': 'SALARY',
        'accountNumberMasked': '5678',
        'balance': 20000,
        'currency': 'INR',
        'isActive': true,
      },
    ],
  },
};

/// A single mixed adapter for the three features under test.
class _FeatureAdapter implements HttpClientAdapter {
  final List<RequestOptions> requests = [];

  int analyticsStatus = 200;
  Map<String, dynamic> analyticsBody = _analyticsEnvelope;

  /// Per-call overrides for `GET /analytics`, consumed in order.
  final List<Map<String, dynamic>> analyticsBodyQueue = [];

  /// Gates for `GET /analytics`, consumed in order. A gated request waits until
  /// its completer resolves, so a test can release responses out of order.
  final List<Completer<void>> analyticsGateQueue = [];

  int forecastStatus = 200;
  int insightsStatus = 200;

  int meStatus = 200;

  int patchStatus = 200;
  String patchError = 'City is not a valid value.';

  /// When set, a PATCH waits until this resolves, so a test can observe the
  /// in-flight state of a save.
  Completer<void>? patchGate;

  int depositStatus = 200;
  String depositError = 'Amount must be a positive number.';

  /// Mutable so a saved PATCH is reflected by the follow-up read.
  late Map<String, dynamic> meData = _deepCopy(_meData);

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

    if (method == 'GET' && path.endsWith('/analytics/forecast')) {
      if (forecastStatus >= 400) {
        return _json(forecastStatus, {
          'success': false,
          'error': {'code': 'SERVER_ERROR', 'message': 'Forecast failed.'},
        });
      }
      return _json(200, _forecastEnvelope);
    }
    if (method == 'GET' && path.endsWith('/analytics/insights')) {
      if (insightsStatus >= 400) {
        return _json(insightsStatus, {
          'success': false,
          'error': {'code': 'SERVER_ERROR', 'message': 'Insights failed.'},
        });
      }
      return _json(200, _insightsEnvelope);
    }
    if (method == 'GET' && path.endsWith('/analytics')) {
      final body = analyticsBodyQueue.isNotEmpty
          ? analyticsBodyQueue.removeAt(0)
          : analyticsBody;
      final gate = analyticsGateQueue.isNotEmpty
          ? analyticsGateQueue.removeAt(0)
          : null;
      if (gate != null) await gate.future;
      if (analyticsStatus >= 400) {
        return _json(analyticsStatus, {
          'success': false,
          'error': {'code': 'VALIDATION_ERROR', 'message': 'Invalid period.'},
        });
      }
      return _json(200, body);
    }
    if (method == 'GET' && path.endsWith('/auth/me')) {
      if (meStatus >= 400) {
        return _json(meStatus, {
          'success': false,
          'error': {'code': 'NOT_FOUND', 'message': 'Profile not found.'},
        });
      }
      return _json(200, {'success': true, 'data': meData});
    }
    if (method == 'PATCH' && path.endsWith('/auth/profile')) {
      final gate = patchGate;
      if (gate != null) await gate.future;
      if (patchStatus >= 400) {
        return _json(patchStatus, {
          'success': false,
          'error': {'code': 'VALIDATION_ERROR', 'message': patchError},
        });
      }
      _mergeProfile(Map<String, dynamic>.from(options.data as Map));
      return _json(200, {
        'success': true,
        'data': {...meData, 'message': 'Profile updated successfully!'},
      });
    }
    if (method == 'GET' && path.endsWith('/accounts')) {
      return _json(200, _accountsEnvelope);
    }
    if (method == 'POST' && path.endsWith('/deposit')) {
      if (depositStatus >= 400) {
        return _json(depositStatus, {
          'success': false,
          'error': {'code': 'VALIDATION_ERROR', 'message': depositError},
        });
      }
      return _json(200, {
        'success': true,
        'data': {
          'message': 'Successfully added ₹5,000.00 to HDFC Savings!',
          'newBalance': 55000,
          'formattedNewBalance': '₹55,000.00',
          'transactionId': 't2',
        },
      });
    }

    return _json(200, {'success': true, 'data': {}});
  }

  /// Applies the backend's conditional-update semantics to the stored profile.
  void _mergeProfile(Map<String, dynamic> payload) {
    for (final entry in payload.entries) {
      switch (entry.key) {
        case 'occupation':
        case 'bio':
          final profile = Map<String, dynamic>.from(meData['profile'] as Map);
          profile[entry.key] = entry.value;
          meData['profile'] = profile;
        case 'firstName':
        case 'lastName':
          meData[entry.key] = entry.value;
        case 'city':
        case 'monthlySalary':
        case 'estimatedMonthlyExpenses':
        case 'riskProfile':
          final financial = Map<String, dynamic>.from(
            meData['financialProfile'] as Map,
          );
          financial[entry.key] = entry.value;
          meData['financialProfile'] = financial;
      }
    }
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

Map<String, dynamic> _deepCopy(Map<String, dynamic> source) =>
    jsonDecode(jsonEncode(source)) as Map<String, dynamic>;

Map<String, dynamic> _bodyOf(RequestOptions request) =>
    Map<String, dynamic>.from(request.data as Map);

Map<String, dynamic> _queryOf(RequestOptions request) =>
    Map<String, dynamic>.from(request.uri.queryParameters);

/// A month envelope whose net-cash-flow figure is a unique marker, so a test
/// can tell exactly which response the screen is displaying.
Map<String, dynamic> _monthEnvelopeWithMarker(String marker) => {
  'success': true,
  'data': {
    'period': 'month',
    'month': 10,
    'year': 2026,
    'summary': {
      'totalIncome': 100,
      'formattedIncome': '₹100.00',
      'totalExpenses': 0,
      'formattedExpenses': '₹0.00',
      'netSavings': 100,
      'formattedNetSavings': 'MARKER-$marker',
      'savingsRate': 100,
      'incomeTransactions': 1,
      'expenseTransactions': 0,
    },
    'monthOverMonth': null,
    'categoryBreakdown': [],
    'monthlyTrend': [],
    'dailyFlow': [],
  },
};

/// Same stub as the other widget tests: skips the real `checkAuthStatus()` so
/// no plugin or network work happens.
class _StubAuth extends AuthNotifier {
  @override
  AuthState build() => AuthState.authenticated(
        UserModel(
          id: 'u1',
          email: 'aarav@example.com',
          username: 'aarav',
          firstName: 'Aarav',
          lastName: 'Sharma',
        ),
      );
}

Future<void> _pump(WidgetTester tester, Widget screen, {bool withAuth = false}) async {
  tester.view.physicalSize = const Size(1200, 2600);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  final app = MaterialApp(home: screen);
  await tester.pumpWidget(
    withAuth
        ? ProviderScope(
            overrides: [authProvider.overrideWith(_StubAuth.new)],
            child: app,
          )
        : app,
  );
  await tester.pumpAndSettle();
}

/// Lets the transient SnackBar timer fire so no timer outlives the test.
Future<void> _flushSnackBar(WidgetTester tester) async {
  await tester.pump(const Duration(seconds: 5));
  await tester.pumpAndSettle();
}

/// Pumps a screen at a fixed logical width and text scale, for narrow-screen and
/// large-text layout checks.
Future<void> _pumpConstrained(
  WidgetTester tester,
  Widget screen, {
  double width = 320,
  double textScale = 1.0,
  bool withAuth = false,
}) async {
  tester.view.physicalSize = Size(width, 2600);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  final app = MaterialApp(
    home: Builder(
      builder: (context) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: screen,
      ),
    ),
  );
  await tester.pumpWidget(
    withAuth
        ? ProviderScope(
            overrides: [authProvider.overrideWith(_StubAuth.new)],
            child: app,
          )
        : app,
  );
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _FeatureAdapter adapter;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
    adapter = _FeatureAdapter();
    apiClient.dio.httpClientAdapter = adapter;
  });

  group('analytics models parse the backend wire shape', () {
    test('summary totals and null percentageChange survive parsing', () {
      final model = AnalyticsModel.fromJson(
        Map<String, dynamic>.from(_analyticsEnvelope['data'] as Map),
      );

      expect(model.period, 'month');
      expect(model.summary.totalIncome, 90000);
      expect(model.summary.totalExpenses, 60000);
      expect(model.summary.netSavings, 30000);
      expect(model.summary.savingsRate, 33);
      expect(model.summary.incomeTransactions, 3);
      expect(model.hasActivity, isTrue);

      final mom = model.monthOverMonth;
      expect(mom, isNotNull);
      expect(mom!.incomeChange.direction, 'up');
      expect(mom.incomeChange.percentageChange, 12.5);
      // A null percentage is a real "no prior baseline", never a 0.
      expect(mom.savings.percentageChange, isNull);

      expect(model.dailyFlow, hasLength(2));
      expect(model.dailyFlow.first.date, DateTime(2026, 10, 1));
      expect(model.categoryBreakdown.single.category, 'Food & Dining');
    });

    test('a summary-less payload is rejected rather than guessed', () {
      expect(
        () => AnalyticsModel.fromJson(const {'period': 'month'}),
        throwsA(isA<ModelParseException>()),
      );
    });

    test('a zero-activity period reports hasActivity == false', () {
      final model = AnalyticsModel.fromJson(
        Map<String, dynamic>.from(_emptyAnalyticsEnvelope['data'] as Map),
      );

      expect(model.summary.totalIncome, 0);
      expect(model.monthOverMonth, isNull);
      expect(model.hasActivity, isFalse);
    });

    test('a future-month forecast keeps a null projection and is flagged', () {
      final forecast = ForecastModel.fromJson({
        'valid': true,
        'method': 'average_daily_run_rate',
        'isEstimate': true,
        'insufficientData': false,
        'month': 11,
        'year': 2026,
        'daysInMonth': 30,
        'elapsedDays': 0,
        'remainingDays': 30,
        'spentSoFar': 0,
        'formattedSpentSoFar': '₹0.00',
        'averageDailySpend': 0,
        'projectedExpense': null,
        'duplicatesExcluded': 0,
        'categories': [],
      });

      expect(forecast.isEstimate, isTrue);
      expect(forecast.projectedExpense, isNull);
      expect(forecast.insufficientData, isFalse);
    });

    test('insight severity and estimate flag are preserved', () {
      final insight = InsightModel.fromJson({
        'type': 'FORECAST_EXCEEDANCE',
        'severity': 'warning',
        'title': 'Spending is trending above last month',
        'explanation': 'The projected total is above September.',
        'isEstimate': true,
      });

      expect(insight.severity, 'warning');
      expect(insight.isEstimate, isTrue);
      expect(insight.title, 'Spending is trending above last month');
    });
  });

  group('analytics screen', () {
    testWidgets('renders the month summary and requests month + year', (
      tester,
    ) async {
      await _pump(tester, const AnalyticsScreen());

      final primary = adapter.last('GET', '/analytics')!;
      expect(_queryOf(primary), containsPair('month', isNotNull));
      expect(_queryOf(primary), containsPair('year', isNotNull));
      // Ordered does not matter; both secondary calls carry the same month.
      expect(_queryOf(adapter.last('GET', '/analytics/forecast')!), {
        'month': '10',
        'year': '2026',
      });

      expect(find.text('Financial Analytics'), findsOneWidget);
      expect(find.text('NET CASH FLOW'), findsOneWidget);
      expect(find.textContaining('₹30,000.00'), findsWidgets);
      expect(find.text('Income vs. expenses'), findsOneWidget);
      expect(find.text('Spending by category'), findsOneWidget);
      expect(find.text('Food & Dining'), findsOneWidget);
      expect(find.text('Month-end forecast'), findsOneWidget);
      expect(find.text('Estimate'), findsOneWidget);
      expect(find.text('Insights'), findsOneWidget);
      expect(
        find.text('Food & Dining is your largest category'),
        findsOneWidget,
      );
    });

    testWidgets('switching to Week asks for period=week and skips secondary', (
      tester,
    ) async {
      await _pump(tester, const AnalyticsScreen());
      expect(adapter.count('GET', '/analytics/forecast'), 1);

      await tester.tap(find.text('Week'));
      await tester.pumpAndSettle();

      final primary = adapter.last('GET', '/analytics')!;
      expect(_queryOf(primary), {'period': 'week'});
      // Forecast/insights need an explicit month, so they are not called for a
      // non-month period.
      expect(adapter.count('GET', '/analytics/forecast'), 1);
      expect(adapter.count('GET', '/analytics/insights'), 1);
      expect(find.text('Month-end forecast'), findsNothing);
    });

    testWidgets('a rejected period surfaces the backend message', (
      tester,
    ) async {
      adapter.analyticsStatus = 400;
      await _pump(tester, const AnalyticsScreen());

      expect(find.byType(ErrorStateView), findsOneWidget);
      expect(find.text('Invalid period.'), findsOneWidget);
    });

    testWidgets('a real zero-activity period shows the empty state', (
      tester,
    ) async {
      adapter.analyticsBody = _emptyAnalyticsEnvelope;
      await _pump(tester, const AnalyticsScreen());

      expect(find.text('No activity in this period'), findsOneWidget);
      // The empty branch is authoritative: no category section is rendered for
      // a zero-activity period.
      expect(find.text('Spending by category'), findsNothing);
      expect(adapter.count('GET', '/analytics'), 1);
    });

    testWidgets('a stale earlier-period response never overwrites a newer one', (
      tester,
    ) async {
      await _pump(tester, const AnalyticsScreen());
      expect(find.textContaining('₹30,000.00'), findsWidgets);

      // Two overlapping refreshes (the app bar action stays reachable while a
      // request is in flight). Responses are released newest-first.
      final older = Completer<void>();
      final newer = Completer<void>();
      adapter.analyticsGateQueue.addAll([older, newer]);
      adapter.analyticsBodyQueue.addAll([
        _monthEnvelopeWithMarker('old'),
        _monthEnvelopeWithMarker('new'),
      ]);

      await tester.tap(find.byTooltip('Refresh'));
      await tester.pump();
      await tester.tap(find.byTooltip('Refresh'));
      await tester.pump();

      newer.complete();
      await tester.pumpAndSettle();
      expect(find.textContaining('MARKER-new'), findsWidgets);

      // The older request resolves last and must be discarded.
      older.complete();
      await tester.pumpAndSettle();
      expect(find.textContaining('MARKER-old'), findsNothing);
      expect(find.textContaining('MARKER-new'), findsWidgets);
    });

    testWidgets('a failed forecast shows unavailable, never an empty result', (
      tester,
    ) async {
      adapter.forecastStatus = 500;
      await _pump(tester, const AnalyticsScreen());

      // A secondary failure never hides the valid primary summary.
      expect(find.text('NET CASH FLOW'), findsOneWidget);
      expect(find.textContaining('₹30,000.00'), findsWidgets);
      // The failed section is not rendered as a genuine empty result.
      expect(find.text('No forecast is available for this month.'), findsNothing);
      expect(
        find.textContaining("Couldn't load the forecast"),
        findsOneWidget,
      );
      // The unrelated secondary section still loaded normally.
      expect(find.text('Estimate'), findsNothing);
      expect(find.text('Food & Dining is your largest category'), findsOneWidget);
    });

    testWidgets('a failed insights request shows unavailable, never empty', (
      tester,
    ) async {
      adapter.insightsStatus = 500;
      await _pump(tester, const AnalyticsScreen());

      expect(find.text('No insights for this period.'), findsNothing);
      expect(
        find.textContaining("Couldn't load insights"),
        findsOneWidget,
      );
      expect(find.text('Month-end forecast'), findsOneWidget);
      expect(find.text('Estimate'), findsOneWidget);
    });

    testWidgets('retrying a failed section re-fetches only the secondary data', (
      tester,
    ) async {
      adapter.forecastStatus = 500;
      await _pump(tester, const AnalyticsScreen());

      expect(find.textContaining("Couldn't load the forecast"), findsOneWidget);
      expect(adapter.count('GET', '/analytics'), 1);

      adapter.forecastStatus = 200;
      await tester.tap(find.text('Retry'));
      await tester.pumpAndSettle();

      expect(find.textContaining("Couldn't load the forecast"), findsNothing);
      expect(find.text('Estimate'), findsOneWidget);
      // The valid primary summary was never re-requested.
      expect(adapter.count('GET', '/analytics'), 1);
      expect(adapter.count('GET', '/analytics/forecast'), 2);
    });
  });

  group('profile screen', () {
    testWidgets('loads /auth/me and shows identity read-only', (tester) async {
      await _pump(tester, const ProfileScreen(), withAuth: true);

      expect(adapter.count('GET', '/auth/me'), 1);
      expect(find.text('Aarav Sharma'), findsOneWidget);
      // Email is rendered once in the identity header and once as the
      // read-only account tile.
      expect(find.text('aarav@example.com'), findsNWidgets(2));
      expect(find.text('PREMIUM'), findsOneWidget);
      // Nothing changed yet, so saving is disabled.
      expect(find.text('No unsaved changes.'), findsOneWidget);
      expect(find.text('Save changes'), findsOneWidget);
    });

    testWidgets('saves only the changed field then re-reads the profile', (
      tester,
    ) async {
      await _pump(tester, const ProfileScreen(), withAuth: true);

      final fields = find.byType(TextFormField);
      await tester.enterText(fields.at(0), 'Aarav K');
      await tester.pump();

      // The dirty hint disappears once the form differs from the server copy.
      expect(find.text('No unsaved changes.'), findsNothing);

      await tester.tap(find.text('Save changes'));
      await tester.pumpAndSettle();

      final patch = adapter.last('PATCH', '/auth/profile')!;
      expect(_bodyOf(patch), {'firstName': 'Aarav K'});
      // The screen re-reads so it shows persisted truth, not a local guess.
      expect(adapter.count('GET', '/auth/me'), 2);
      expect(find.text('Aarav K Sharma'), findsOneWidget);

      await _flushSnackBar(tester);
    });

    testWidgets('a rejected save shows the message and keeps the typed value', (
      tester,
    ) async {
      adapter.patchStatus = 400;
      await _pump(tester, const ProfileScreen(), withAuth: true);

      // Index 3 is the City field in the widget order.
      final fields = find.byType(TextFormField);
      await tester.enterText(fields.at(3), 'Nowhere');
      await tester.pump();

      await tester.tap(find.text('Save changes'));
      await tester.pumpAndSettle();

      expect(find.text(adapter.patchError), findsOneWidget);
      // The typed value is preserved and no success path ran.
      expect(find.text('Nowhere'), findsOneWidget);
      expect(adapter.count('GET', '/auth/me'), 1);
      expect(find.text('Save changes'), findsOneWidget);
    });

    testWidgets('a repeated save while in flight sends a single PATCH', (
      tester,
    ) async {
      await _pump(tester, const ProfileScreen(), withAuth: true);

      final fields = find.byType(TextFormField);
      await tester.enterText(fields.at(0), 'Aarav K');
      await tester.pump();

      final gate = Completer<void>();
      adapter.patchGate = gate;

      // Invoke the same save closure twice in one synchronous step. The
      // disabled button alone cannot stop a same-frame double tap, so only the
      // internal in-flight guard can.
      final save = tester
          .widget<GradientButton>(find.byType(GradientButton))
          .onPressed!;
      save();
      save();
      // Let Dio's async pipeline reach the adapter without settling (the gated
      // request keeps the button spinner animating, so pumpAndSettle would hang).
      for (var i = 0; i < 10 && adapter.count('PATCH', '/auth/profile') == 0; i++) {
        await tester.pump(const Duration(milliseconds: 10));
      }

      // The button is in its loading state and exactly one request went out.
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(adapter.count('PATCH', '/auth/profile'), 1);

      gate.complete();
      await tester.pumpAndSettle();
      expect(adapter.count('PATCH', '/auth/profile'), 1);
      expect(find.text('Aarav K Sharma'), findsOneWidget);

      await _flushSnackBar(tester);
    });
  });

  group('account deposit', () {
    testWidgets('posts the amount and refreshes balances only after 2xx', (
      tester,
    ) async {
      await _pump(tester, const AccountsScreen());
      expect(find.text('HDFC Savings'), findsOneWidget);

      await tester.tap(find.byTooltip('Deposit funds'));
      await tester.pumpAndSettle();

      // Two accounts -> the selector is rendered and defaults to the first.
      expect(find.text('Deposit into'), findsOneWidget);
      await tester.enterText(find.byType(TextFormField), '5000');
      await tester.pump();

      await tester.tap(find.byType(GradientButton));
      await tester.pumpAndSettle();

      final post = adapter.last('POST', '/accounts/a1/deposit');
      expect(post, isNotNull);
      final body = _bodyOf(post!);
      expect(body['amount'], 5000.0);
      // The deposit carries an idempotency key so a retry of the same
      // deposit can never credit the account twice.
      expect(body['idempotencyKey'], isA<String>());
      expect((body['idempotencyKey'] as String).length, greaterThanOrEqualTo(8));
      // Balances are re-read from the server after the write succeeded.
      expect(adapter.count('GET', '/accounts'), 2);
      expect(
        find.textContaining('Successfully added ₹5,000.00'),
        findsOneWidget,
      );

      await _flushSnackBar(tester);
    });

    testWidgets('a retry of the same deposit reuses the idempotency key', (
      tester,
    ) async {
      // The first attempt fails at the transport level; the deposit may or may
      // not have been applied. The retry must carry the SAME key so the
      // server can recognise it as the same deposit.
      adapter.depositStatus = 500;
      await _pump(tester, const AccountsScreen());

      await tester.tap(find.byTooltip('Deposit funds'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField), '5000');
      await tester.pump();
      await tester.tap(find.byType(GradientButton));
      await tester.pumpAndSettle();

      final firstBody = _bodyOf(adapter.last('POST', '/accounts/a1/deposit')!);
      expect(firstBody['idempotencyKey'], isNotNull);

      // Retry the same deposit.
      adapter.depositStatus = 200;
      await tester.tap(find.byType(GradientButton));
      await tester.pumpAndSettle();

      final posts = adapter
          .requests
          .where((r) => r.method.toUpperCase() == 'POST' && r.uri.path.endsWith('/deposit'))
          .toList();
      expect(posts.length, 2);
      final secondBody = _bodyOf(posts.last);
      expect(secondBody['idempotencyKey'], firstBody['idempotencyKey']);

      await _flushSnackBar(tester);
    });

    testWidgets('a rejected deposit keeps the sheet open and does not refresh', (
      tester,
    ) async {
      adapter.depositStatus = 400;
      await _pump(tester, const AccountsScreen());

      await tester.tap(find.byTooltip('Deposit funds'));
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextFormField), '5000');
      await tester.pump();
      await tester.tap(find.byType(GradientButton));
      await tester.pumpAndSettle();

      expect(adapter.last('POST', '/accounts/a1/deposit'), isNotNull);
      expect(find.text(adapter.depositError), findsOneWidget);
      // No optimistic success: the sheet stays and balances are untouched.
      expect(find.text('Add money'), findsWidgets);
      expect(adapter.count('GET', '/accounts'), 1);
    });

    testWidgets('a non-positive amount is blocked before any request', (
      tester,
    ) async {
      await _pump(tester, const AccountsScreen());

      await tester.tap(find.byTooltip('Deposit funds'));
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextFormField), '0');
      await tester.pump();
      await tester.tap(find.byType(GradientButton));
      await tester.pumpAndSettle();

      expect(find.text('Enter an amount greater than ₹0.'), findsOneWidget);
      expect(adapter.count('POST', '/deposit'), 0);
      expect(adapter.count('GET', '/accounts'), 1);
    });
  });

  // Narrow screens and large accessibility text must not throw layout
  // overflows. `testWidgets` fails the test if a RenderFlex overflows during
  // layout, so simply pumping and settling is the assertion.
  group('layout resilience', () {
    testWidgets('analytics fits a narrow screen with large text', (
      tester,
    ) async {
      await _pumpConstrained(
        tester,
        const AnalyticsScreen(),
        width: 320,
        textScale: 1.5,
      );

      expect(find.text('Financial Analytics'), findsOneWidget);
      expect(find.text('NET CASH FLOW'), findsOneWidget);
    });

    testWidgets('profile fits a narrow screen with large text', (tester) async {
      await _pumpConstrained(
        tester,
        const ProfileScreen(),
        width: 320,
        textScale: 1.5,
        withAuth: true,
      );

      expect(find.text('Save changes'), findsOneWidget);
      expect(find.text('PERSONAL DETAILS'), findsOneWidget);
    });
  });
}
