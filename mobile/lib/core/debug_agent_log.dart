import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

/// Temporary debug ingest used only while diagnosing auth failures.
void agentLog({
  required String location,
  required String message,
  required String hypothesisId,
  Map<String, dynamic>? data,
}) {
  // #region agent log
  final payload = <String, dynamic>{
    'sessionId': '60a356',
    'hypothesisId': hypothesisId,
    'location': location,
    'message': message,
    'data': data ?? <String, dynamic>{},
    'timestamp': DateTime.now().millisecondsSinceEpoch,
  };
  final body = jsonEncode(payload);
  debugPrint('DEBUG_60a356 $body');
  for (final host in ['127.0.0.1', '10.0.2.2']) {
    () async {
      HttpClient? client;
      try {
        client = HttpClient();
        client.connectionTimeout = const Duration(seconds: 2);
        final req = await client.postUrl(
          Uri.parse(
            'http://$host:7313/ingest/f557796d-0446-44a6-b6c3-5db6b1595bd4',
          ),
        );
        req.headers.set('Content-Type', 'application/json');
        req.headers.set('X-Debug-Session-Id', '60a356');
        req.add(utf8.encode(body));
        await req.close().timeout(const Duration(seconds: 2));
      } catch (_) {
      } finally {
        client?.close(force: true);
      }
    }();
  }
  try {
    File(
      '/Volumes/Projects/Minor/Jinay Version/Fin_AI_Personal_Financial_Planner_AI_Final_Year_Project/.cursor/debug-60a356.log',
    ).writeAsStringSync('$body\n', mode: FileMode.append, flush: true);
  } catch (_) {}
  // #endregion
}
