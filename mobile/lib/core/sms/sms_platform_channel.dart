import 'package:flutter/services.dart';
import '../api/api_client.dart';
import '../api/api_endpoints.dart';
import 'sms_parser.dart';

class SmsPlatformChannel {
  static const MethodChannel _channel = MethodChannel(
    'com.finpro.app/sms_channel',
  );

  static Future<bool> checkPermission() async {
    try {
      final res = await _channel.invokeMethod<bool>('checkSmsPermission');
      return res ?? false;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> requestPermission() async {
    try {
      final res = await _channel.invokeMethod<bool>('requestSmsPermission');
      return res ?? false;
    } catch (_) {
      return false;
    }
  }

  /// Whether the user has switched on-device bank SMS detection on/off.
  /// Permission and preference are separate: Android cannot revoke an already
  /// granted runtime permission from code, so the app owns an explicit flag.
  static Future<bool> isDetectionEnabled() async {
    try {
      final res = await _channel.invokeMethod<bool>('isSmsDetectionEnabled');
      return res ?? true;
    } catch (_) {
      return true;
    }
  }

  static Future<bool> setDetectionEnabled(bool enabled) async {
    try {
      final res = await _channel.invokeMethod<bool>(
        'setSmsDetectionEnabled',
        {'enabled': enabled},
      );
      return res ?? enabled;
    } catch (_) {
      return enabled;
    }
  }

  static Future<List<Map<String, dynamic>>> getBufferedSms() async {
    try {
      final res = await _channel.invokeListMethod<dynamic>('getBufferedSms');
      if (res != null) {
        return res
            .map((item) => Map<String, dynamic>.from(item as Map))
            .toList();
      }
    } catch (_) {}
    return [];
  }

  static Future<void> clearBufferedSms() async {
    try {
      await _channel.invokeMethod('clearBufferedSms');
    } catch (_) {}
  }

  static Future<List<Map<String, dynamic>>> readRecentInboxSms() async {
    try {
      final res = await _channel.invokeListMethod<dynamic>(
        'readRecentInboxSms',
      );
      if (res != null) {
        return res
            .map((item) => Map<String, dynamic>.from(item as Map))
            .toList();
      }
    } catch (_) {}
    return [];
  }

  /// Ingest buffered SMS messages to backend API
  static Future<int> syncBufferedMessagesToBackend() async {
    final buffered = await getBufferedSms();
    if (buffered.isEmpty) return 0;

    final List<Map<String, dynamic>> payload = [];
    for (final item in buffered) {
      final body = item['body']?.toString() ?? '';
      final sender = item['sender']?.toString() ?? 'BANK_SMS';
      final candidate = SmsParser.parse(body, sender: sender);

      if (candidate.isTransaction) {
        payload.add(candidate.toIngestJson());
      }
    }

    if (payload.isNotEmpty) {
      try {
        final res = await apiClient.post(
          ApiEndpoints.smsBatchIngest,
          data: {'messages': payload},
        );

        if (res.statusCode == 200 && res.data['success'] == true) {
          await clearBufferedSms();
          return res.data['data']['ingested'] ?? payload.length;
        }
      } catch (_) {}
    } else {
      await clearBufferedSms();
    }

    return 0;
  }
}
