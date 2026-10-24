import 'package:flutter/foundation.dart';

/// Emits whenever the API layer determines that the stored session can no
/// longer be renewed (the refresh token is missing, invalid, or expired).
///
/// Kept in a dependency-free file so the API client can signal the auth layer
/// without importing it (which would create an import cycle).
final ValueNotifier<int> sessionExpiredNotifier = ValueNotifier<int>(0);

void notifySessionExpired() {
  sessionExpiredNotifier.value++;
}
