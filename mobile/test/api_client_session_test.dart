import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:finpro_mobile/core/api/api_client.dart';
import 'package:finpro_mobile/core/api/api_endpoints.dart';
import 'package:finpro_mobile/core/auth/session_events.dart';
import 'package:finpro_mobile/core/auth/token_storage.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Serves deterministic responses for the protected endpoint and the refresh
/// endpoint so concurrent-401 behaviour can be asserted without a network.
class _RefreshAdapter implements HttpClientAdapter {
  _RefreshAdapter({
    required this.refreshSucceeds,
    this.acceptRefreshedToken = true,
  });

  final bool refreshSucceeds;
  final bool acceptRefreshedToken;
  int refreshCalls = 0;
  int protectedCalls = 0;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    if (options.path.endsWith('/auth/refresh')) {
      refreshCalls++;
      // Hold the refresh open long enough for the second concurrent 401 to
      // join the in-flight future instead of starting its own rotation.
      await Future<void>.delayed(const Duration(milliseconds: 80));
      if (!refreshSucceeds) {
        return _json(401, {'success': false, 'message': 'invalid refresh'});
      }
      return _json(200, {
        'success': true,
        'data': {'accessToken': 'new-access', 'refreshToken': 'new-refresh'},
      });
    }

    protectedCalls++;
    final auth = options.headers['Authorization'];
    if (acceptRefreshedToken && auth == 'Bearer new-access') {
      return _json(200, {'success': true, 'data': {}});
    }
    return _json(401, {'success': false, 'message': 'token expired'});
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

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
    await TokenStorage.clearAll();
    sessionExpiredNotifier.value = 0;
  });

  tearDown(() async {
    await TokenStorage.clearAll();
  });

  test('concurrent 401s share one refresh and both retries succeed', () async {
    await TokenStorage.saveTokens(
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
    );

    final adapter = _RefreshAdapter(refreshSucceeds: true);
    final refreshClient = Dio()..httpClientAdapter = adapter;
    final client = ApiClient(refreshClient: refreshClient);
    client.dio.httpClientAdapter = adapter;

    final responses = await Future.wait([
      client.get('${ApiEndpoints.baseUrl}/accounts'),
      client.get('${ApiEndpoints.baseUrl}/goals'),
    ]);

    expect(adapter.refreshCalls, 1);
    expect(adapter.protectedCalls, 4); // two original 401s + two retries
    expect(responses.every((r) => r.statusCode == 200), isTrue);
    expect(await TokenStorage.getAccessToken(), 'new-access');
    expect(await TokenStorage.getRefreshToken(), 'new-refresh');
    expect(sessionExpiredNotifier.value, 0);
  });

  test(
    'failed refresh clears tokens and signals session expiry once',
    () async {
      await TokenStorage.saveTokens(
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
      );

      final adapter = _RefreshAdapter(refreshSucceeds: false);
      final refreshClient = Dio()..httpClientAdapter = adapter;
      final client = ApiClient(refreshClient: refreshClient);
      client.dio.httpClientAdapter = adapter;

      await expectLater(
        Future.wait([
          client.get('${ApiEndpoints.baseUrl}/accounts'),
          client.get('${ApiEndpoints.baseUrl}/goals'),
        ]),
        throwsA(isA<DioException>()),
      );

      expect(adapter.refreshCalls, 1);
      expect(await TokenStorage.getAccessToken(), isNull);
      expect(await TokenStorage.getRefreshToken(), isNull);
      expect(sessionExpiredNotifier.value, 1);
    },
  );

  test('a 401 without a refresh token expires the session', () async {
    await TokenStorage.saveTokens(accessToken: 'old-access', refreshToken: '');

    final adapter = _RefreshAdapter(refreshSucceeds: true);
    final client = ApiClient(refreshClient: Dio()..httpClientAdapter = adapter);
    client.dio.httpClientAdapter = adapter;

    await expectLater(
      client.get('${ApiEndpoints.baseUrl}/accounts'),
      throwsA(isA<DioException>()),
    );

    expect(adapter.refreshCalls, 0);
    expect(await TokenStorage.getAccessToken(), isNull);
    expect(sessionExpiredNotifier.value, 1);
  });

  test('a rejected refreshed token expires without looping', () async {
    await TokenStorage.saveTokens(
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
    );

    final adapter = _RefreshAdapter(
      refreshSucceeds: true,
      acceptRefreshedToken: false,
    );
    final refreshClient = Dio()..httpClientAdapter = adapter;
    final client = ApiClient(refreshClient: refreshClient);
    client.dio.httpClientAdapter = adapter;

    await expectLater(
      client.get('${ApiEndpoints.baseUrl}/accounts'),
      throwsA(isA<DioException>()),
    );

    expect(adapter.refreshCalls, 1);
    expect(adapter.protectedCalls, 2); // original 401 + exactly one retry
    expect(await TokenStorage.getAccessToken(), isNull);
    expect(await TokenStorage.getRefreshToken(), isNull);
    expect(sessionExpiredNotifier.value, 1);
  });
}
