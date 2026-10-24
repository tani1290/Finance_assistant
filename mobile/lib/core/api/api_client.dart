import 'package:dio/dio.dart';
import '../auth/session_events.dart';
import '../auth/token_storage.dart';
import 'api_endpoints.dart';

class ApiClient {
  late final Dio dio;

  /// Refresh runs on its own client so it can never recurse through the 401
  /// interceptor. Injectable for tests that exercise concurrent 401 handling.
  final Dio _refreshClient;

  /// A single in-flight refresh shared by all concurrent 401 responses.
  /// The backend rotates refresh tokens, so parallel refresh calls would
  /// invalidate each other and log the user out mid-session.
  Future<String?>? _refreshInFlight;
  bool _expiringSession = false;

  ApiClient({Dio? refreshClient})
    : _refreshClient =
          refreshClient ??
          Dio(
            BaseOptions(
              connectTimeout: const Duration(seconds: 20),
              receiveTimeout: const Duration(seconds: 20),
            ),
          ) {
    dio = Dio(
      BaseOptions(
        connectTimeout: const Duration(seconds: 45),
        receiveTimeout: const Duration(seconds: 45),
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          // Identifies this device as the mobile client. The backend tags every
          // realtime event it originates with this value, so the web app knows a
          // change came from a phone (and, for SMS, chimes + refreshes instantly).
          'X-Client': 'mobile',
        },
      ),
    );

    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = await TokenStorage.getAccessToken();
          if (token != null) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          return handler.next(options);
        },
        onError: (DioException error, handler) async {
          // Transparent 401 token refresh loop — never treat login/register as expired JWT
          final path = error.requestOptions.path;
          final isCredentialAuth =
              path.contains('/auth/login') || path.contains('/auth/register');
          final alreadyRetried =
              error.requestOptions.extra['__retried401'] == true;

          if (error.response?.statusCode == 401 &&
              !path.contains('/auth/refresh') &&
              !isCredentialAuth) {
            if (alreadyRetried) {
              // The freshly issued token was rejected too: the session is no
              // longer valid. Never retry in a loop against a 401 endpoint.
              await _expireSession();
              return handler.next(error);
            }

            // Another request may already have refreshed the session while
            // this one was in flight. Retry with the current token instead of
            // rotating the refresh token a second time.
            final requestAuth = error.requestOptions.headers['Authorization']
                ?.toString();
            final currentToken = await TokenStorage.getAccessToken();
            if (currentToken != null && requestAuth != 'Bearer $currentToken') {
              error.requestOptions.headers['Authorization'] =
                  'Bearer $currentToken';
              error.requestOptions.extra['__retried401'] = true;
              try {
                final clonedRequest = await dio.fetch(error.requestOptions);
                return handler.resolve(clonedRequest);
              } on DioException catch (retryError) {
                // The retry's own 401 passes through this interceptor again
                // (with __retried401 set) and expires the session there, so no
                // duplicate expiry is signalled here.
                return handler.next(retryError);
              }
            }

            final refreshToken = await TokenStorage.getRefreshToken();
            if (refreshToken != null && refreshToken.isNotEmpty) {
              final newAccessToken = await _refreshAccessToken(refreshToken);

              if (newAccessToken != null) {
                // Retry the original request with new token
                error.requestOptions.headers['Authorization'] =
                    'Bearer $newAccessToken';
                error.requestOptions.extra['__retried401'] = true;
                try {
                  final clonedRequest = await dio.fetch(error.requestOptions);
                  return handler.resolve(clonedRequest);
                } on DioException catch (retryError) {
                  // Handled by the retry's own interceptor pass, as above.
                  return handler.next(retryError);
                }
              }
            } else {
              await _expireSession();
            }
          }
          return handler.next(error);
        },
      ),
    );
  }

  Future<String?> _refreshAccessToken(String refreshToken) {
    return _refreshInFlight ??= _performRefresh(refreshToken).whenComplete(() {
      _refreshInFlight = null;
    });
  }

  Future<String?> _performRefresh(String refreshToken) async {
    try {
      final refreshResponse = await _refreshClient.post(
        ApiEndpoints.refresh,
        data: {'refreshToken': refreshToken},
      );

      if (refreshResponse.statusCode == 200 &&
          refreshResponse.data['success'] == true) {
        final data = refreshResponse.data['data'];
        final newAccessToken = data['accessToken'];
        if (newAccessToken is String && newAccessToken.isNotEmpty) {
          await TokenStorage.saveTokens(
            accessToken: newAccessToken,
            refreshToken: data['refreshToken']?.toString() ?? refreshToken,
          );
          return newAccessToken;
        }
      }
    } catch (_) {
      // Network failure or rejected refresh token: the session is no longer
      // usable. Fall through to a single, explicit expiry notification.
    }

    await _expireSession();
    return null;
  }

  Future<void> _expireSession() async {
    if (_expiringSession) return;
    _expiringSession = true;
    try {
      await TokenStorage.clearAll();
    } finally {
      _expiringSession = false;
      notifySessionExpired();
    }
  }

  Future<Response> get(String path, {Map<String, dynamic>? queryParameters}) {
    return dio.get(path, queryParameters: queryParameters);
  }

  Future<Response> post(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) {
    return dio.post(
      path,
      data: data,
      queryParameters: queryParameters,
      options: options,
    );
  }

  Future<Response> patch(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
  }) {
    return dio.patch(path, data: data, queryParameters: queryParameters);
  }

  Future<Response> delete(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
  }) {
    return dio.delete(path, data: data, queryParameters: queryParameters);
  }
}

final apiClient = ApiClient();
