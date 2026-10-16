import 'package:dio/dio.dart';
import '../auth/token_storage.dart';
import 'api_endpoints.dart';

class ApiClient {
  late final Dio dio;

  ApiClient() {
    dio = Dio(
      BaseOptions(
        connectTimeout: const Duration(seconds: 45),
        receiveTimeout: const Duration(seconds: 45),
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
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
          final isCredentialAuth = path.contains('/auth/login') ||
              path.contains('/auth/register');
          if (error.response?.statusCode == 401 &&
              !path.contains('/auth/refresh') &&
              !isCredentialAuth) {
            final refreshToken = await TokenStorage.getRefreshToken();
            if (refreshToken != null) {
              try {
                final refreshResponse = await Dio().post(
                  ApiEndpoints.refresh,
                  data: {'refreshToken': refreshToken},
                );

                if (refreshResponse.statusCode == 200 &&
                    refreshResponse.data['success'] == true) {
                  final newAccessToken =
                      refreshResponse.data['data']['accessToken'];
                  final newRefreshToken =
                      refreshResponse.data['data']['refreshToken'];

                  await TokenStorage.saveTokens(
                    accessToken: newAccessToken,
                    refreshToken: newRefreshToken ?? refreshToken,
                  );

                  // Retry the original request with new token
                  error.requestOptions.headers['Authorization'] =
                      'Bearer $newAccessToken';
                  final clonedRequest = await dio.fetch(error.requestOptions);
                  return handler.resolve(clonedRequest);
                }
              } catch (_) {
                await TokenStorage.clearAll();
              }
            }
          }
          return handler.next(error);
        },
      ),
    );
  }

  Future<Response> get(String path, {Map<String, dynamic>? queryParameters}) {
    return dio.get(path, queryParameters: queryParameters);
  }

  Future<Response> post(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
  }) {
    return dio.post(path, data: data, queryParameters: queryParameters);
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
    Map<String, dynamic>? queryParameters,
  }) {
    return dio.delete(path, queryParameters: queryParameters);
  }
}

final apiClient = ApiClient();
