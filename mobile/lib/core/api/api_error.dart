import 'package:dio/dio.dart';

/// Pulls the backend's human-readable message out of a response body.
///
/// The API answers failures with `{ success: false, error: { code, message } }`
/// and successes that carry a confirmation string with
/// `{ success: true, data: { message } }`. Both shapes are read here so callers
/// can surface the server's own wording (for example a validation message)
/// instead of a generic one.
String? serverMessage(dynamic body) {
  if (body is! Map) return null;

  final error = body['error'];
  if (error is Map) {
    final message = error['message'];
    if (message is String && message.trim().isNotEmpty) return message.trim();
  }

  final data = body['data'];
  if (data is Map) {
    final message = data['message'];
    if (message is String && message.trim().isNotEmpty) return message.trim();
  }

  final message = body['message'];
  if (message is String && message.trim().isNotEmpty) return message.trim();

  return null;
}

/// Returns the backend's error message for a failed request, or `null` when
/// the failure carried no usable body (offline, timeout, malformed payload).
///
/// Dio throws `DioException` for any non-2xx status, so the response body of a
/// rejected request is only reachable through the caught error. Server-side
/// 5xx bodies are deliberately ignored: they can describe internals, so callers
/// fall back to a generic message instead.
String? apiErrorMessage(Object error) {
  if (error is! DioException) return null;
  final status = error.response?.statusCode;
  if (status == null || status >= 500) return null;
  return serverMessage(error.response?.data);
}
