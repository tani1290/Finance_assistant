import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:finpro_mobile/core/api/api_client.dart';
import 'package:finpro_mobile/core/api/api_endpoints.dart';
import 'package:finpro_mobile/core/firebase/fcm_token_manager.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Records every request and answers with a fixed status, an optional delay,
/// or a thrown transport error, so the manager's best-effort behaviour can be
/// asserted without a network or Firebase plugins.
class _RecordingAdapter implements HttpClientAdapter {
  _RecordingAdapter({this.statusCode = 200, this.delay = Duration.zero});

  final int statusCode;
  final Duration delay;
  final List<RequestOptions> requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    if (delay > Duration.zero) {
      await Future<void>.delayed(delay);
    }
    return ResponseBody.fromString(
      jsonEncode({'success': true, 'data': <String, dynamic>{}}),
      statusCode,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

class _ThrowingAdapter implements HttpClientAdapter {
  int calls = 0;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    calls++;
    throw DioException(requestOptions: options, message: 'transport down');
  }

  @override
  void close({bool force = false}) {}
}

ApiClient _clientWith(HttpClientAdapter adapter) {
  final client = ApiClient();
  client.dio.httpClientAdapter = adapter;
  return client;
}

FcmTokenManager _manager({
  required ApiClient client,
  Future<String?> Function()? tokenProvider,
  Future<void> Function()? localDeleter,
  Duration serverTimeout = const Duration(seconds: 5),
  Duration localTimeout = const Duration(seconds: 2),
}) {
  return FcmTokenManager(
    client: client,
    tokenProvider: tokenProvider ?? () async => 'device-token',
    localTokenDeleter: localDeleter ?? () async {},
    serverTimeout: serverTimeout,
    localTimeout: localTimeout,
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    // The ApiClient request interceptor reads the access token from
    // TokenStorage. Without these mocks the platform channels are absent and
    // the interceptor throws before the request ever reaches the adapter.
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
  });

  test('a healthy backend is sent the token, then the platform token is '
      'deleted', () async {
    final adapter = _RecordingAdapter();
    var localDeletes = 0;
    final manager = _manager(
      client: _clientWith(adapter),
      localDeleter: () async => localDeletes++,
    );

    final result = await manager.unregister();

    expect(result, isTrue);
    expect(adapter.requests, hasLength(1));
    expect(adapter.requests.single.method, 'DELETE');
    expect(adapter.requests.single.path, ApiEndpoints.fcmToken);
    expect(adapter.requests.single.data, {'fcmToken': 'device-token'});
    expect(localDeletes, 1);
  });

  test(
    'a failing backend still deletes the platform token and reports false',
    () async {
      final adapter = _RecordingAdapter(statusCode: 500);
      var localDeletes = 0;
      final manager = _manager(
        client: _clientWith(adapter),
        localDeleter: () async => localDeletes++,
      );

      final result = await manager.unregister();

      expect(result, isFalse);
      expect(localDeletes, 1);
      expect(adapter.requests, hasLength(1));
    },
  );

  test(
    'an unreachable backend is time-bounded and does not block sign-out',
    () async {
      final adapter = _RecordingAdapter(
        delay: const Duration(milliseconds: 400),
      );
      var localDeletes = 0;
      final manager = _manager(
        client: _clientWith(adapter),
        serverTimeout: const Duration(milliseconds: 40),
        localTimeout: const Duration(milliseconds: 200),
        localDeleter: () async => localDeletes++,
      );

      final stopwatch = Stopwatch()..start();
      final result = await manager.unregister();
      stopwatch.stop();

      expect(result, isFalse);
      expect(localDeletes, 1);
      expect(
        stopwatch.elapsed,
        lessThan(const Duration(milliseconds: 300)),
        reason: 'the server timeout must bound the wait',
      );
    },
  );

  test('a transport error is swallowed and local cleanup still runs', () async {
    final adapter = _ThrowingAdapter();
    var localDeletes = 0;
    final manager = _manager(
      client: _clientWith(adapter),
      localDeleter: () async => localDeletes++,
    );

    final result = await manager.unregister();

    expect(result, isFalse);
    expect(adapter.calls, 1);
    expect(localDeletes, 1);
  });

  test('with no device token the backend is not called, avoiding a blanket '
      'delete of the user\'s other devices', () async {
    final adapter = _RecordingAdapter();
    var localDeletes = 0;
    final manager = _manager(
      client: _clientWith(adapter),
      tokenProvider: () async => null,
      localDeleter: () async => localDeletes++,
    );

    final result = await manager.unregister();

    expect(result, isTrue);
    expect(adapter.requests, isEmpty);
    expect(localDeletes, 1);
  });

  test(
    'a failing local delete never propagates and keeps the server result',
    () async {
      final adapter = _RecordingAdapter();
      final manager = _manager(
        client: _clientWith(adapter),
        localDeleter: () async => throw StateError('plugin missing'),
      );

      final result = await manager.unregister();

      expect(result, isTrue);
    },
  );

  test('concurrent unregisters issue exactly one delete sequence', () async {
    final adapter = _RecordingAdapter(delay: const Duration(milliseconds: 60));
    var localDeletes = 0;
    final manager = _manager(
      client: _clientWith(adapter),
      localDeleter: () async => localDeletes++,
    );

    final results = await Future.wait([
      manager.unregister(),
      manager.unregister(),
    ]);

    expect(results.where((r) => r).length, 1);
    expect(results.where((r) => !r).length, 1);
    expect(adapter.requests, hasLength(1));
    expect(localDeletes, 1);
    expect(manager.isInProgress, isFalse);
  });

  test('register posts the token, the stable device id and the platform', () async {
    final adapter = _RecordingAdapter();
    final manager = _manager(client: _clientWith(adapter));

    final result = await manager.register(
      token: 'device-token',
      deviceId: 'finpro-0123456789abcdef0123456789abcdef',
      platform: 'android',
    );

    expect(result, isTrue);
    expect(adapter.requests, hasLength(1));
    final request = adapter.requests.single;
    expect(request.method, 'POST');
    expect(request.path, ApiEndpoints.fcmToken);
    // The backend upserts by (userId, deviceId) when deviceId is present; an
    // omitted id makes it delete the user's other tokens, so it must be sent.
    expect(request.data, {
      'fcmToken': 'device-token',
      'deviceId': 'finpro-0123456789abcdef0123456789abcdef',
      'platform': 'android',
    });
  });

  test('register with no token or no device id does not call the backend', () async {
    final adapter = _RecordingAdapter();
    final manager = _manager(client: _clientWith(adapter));

    expect(
      await manager.register(token: '', deviceId: 'finpro-x', platform: 'ios'),
      isFalse,
    );
    expect(
      await manager.register(token: 'device-token', deviceId: '', platform: 'ios'),
      isFalse,
    );
    expect(adapter.requests, isEmpty);
  });

  test('a rejected registration is swallowed and reports false', () async {
    final adapter = _RecordingAdapter(statusCode: 400);
    final manager = _manager(client: _clientWith(adapter));

    final result = await manager.register(
      token: 'device-token',
      deviceId: 'finpro-x',
      platform: 'ios',
    );

    expect(result, isFalse);
    expect(adapter.requests, hasLength(1));
  });

  test('a transport failure during registration is swallowed', () async {
    final adapter = _ThrowingAdapter();
    final manager = _manager(client: _clientWith(adapter));

    final result = await manager.register(
      token: 'device-token',
      deviceId: 'finpro-x',
      platform: 'ios',
    );

    expect(result, isFalse);
    expect(adapter.calls, 1);
  });
}
