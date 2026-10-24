import 'package:flutter/foundation.dart';

/// Debug-only logging.
///
/// Unlike a bare [debugPrint], this is a no-op in release builds, so diagnostic
/// output that could carry identifiers, tokens, or financial context never
/// reaches release logs or crash-report breadcrumbs.
void logDebug(String message) {
  if (kDebugMode) {
    debugPrint(message);
  }
}
