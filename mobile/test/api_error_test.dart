import 'package:dio/dio.dart';
import 'package:finpro_mobile/core/api/api_error.dart';
import 'package:flutter_test/flutter_test.dart';

/// Builds a `DioException` carrying a response body, the way Dio raises it for
/// a non-2xx reply. The body shapes below are copied from the backend's error
/// handler (`{ success: false, error: { code, message } }`).
DioException _failure(int? statusCode, Object? body) {
  final options = RequestOptions(path: '/api/v1/goals');
  return DioException(
    requestOptions: options,
    response: statusCode == null
        ? null
        : Response<Object?>(
            requestOptions: options,
            statusCode: statusCode,
            data: body,
          ),
  );
}

void main() {
  group('serverMessage', () {
    test('reads error.message from a validation failure', () {
      expect(
        serverMessage({
          'success': false,
          'error': {'code': 'VALIDATION_ERROR', 'message': 'Name is required.'},
        }),
        'Name is required.',
      );
    });

    test('reads data.message from a success confirmation', () {
      expect(
        serverMessage({
          'success': true,
          'data': {'message': 'Goal created successfully.'},
        }),
        'Goal created successfully.',
      );
    });

    test('falls back to a top-level message', () {
      expect(serverMessage({'message': 'Something happened.'}), 'Something happened.');
    });

    test('returns null when no usable message is present', () {
      expect(serverMessage({'success': false}), isNull);
      expect(serverMessage('not a map'), isNull);
      expect(serverMessage(null), isNull);
    });
  });

  group('apiErrorMessage', () {
    test('surfaces the backend message for a 4xx validation failure', () {
      expect(
        apiErrorMessage(
          _failure(400, {
            'success': false,
            'error': {'code': 'VALIDATION_ERROR', 'message': 'Enter a goal name.'},
          }),
        ),
        'Enter a goal name.',
      );
    });

    test('returns null for a 5xx so internal details are never shown', () {
      expect(
        apiErrorMessage(
          _failure(500, {
            'success': false,
            'error': {
              'code': 'INTERNAL_ERROR',
              'message': 'An internal server error occurred.',
            },
          }),
        ),
        isNull,
      );
    });

    test('returns null for a transport failure with no response', () {
      expect(apiErrorMessage(_failure(null, null)), isNull);
    });

    test('returns null for a non-Dio error', () {
      expect(apiErrorMessage(StateError('boom')), isNull);
    });
  });
}
