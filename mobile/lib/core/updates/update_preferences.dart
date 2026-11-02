import 'package:shared_preferences/shared_preferences.dart';

/// Persists which release the user has already been told about.
///
/// "Don't repeat notifications for the same release" is a product requirement,
/// so the dismissal key must survive restarts. A newer release (different
/// version or build) gets a new key and will be shown again.
class UpdatePreferences {
  UpdatePreferences._();

  static const String _dismissedKey = 'finpro_update_dismissed_release';
  static const String _lastCheckedKey = 'finpro_update_last_check_ms';

  static String releaseKey({
    required String platform,
    required String version,
    required int build,
  }) => '$platform:$version:$build';

  static Future<String?> dismissedRelease() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getString(_dismissedKey);
    } catch (_) {
      return null;
    }
  }

  static Future<void> dismiss(String key) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_dismissedKey, key);
    } catch (_) {
      // Best effort: the in-memory dismissal still prevents an immediate
      // re-prompt during this session.
    }
  }

  static Future<DateTime?> lastCheckedAt() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final millis = prefs.getInt(_lastCheckedKey);
      if (millis == null || millis <= 0) return null;
      return DateTime.fromMillisecondsSinceEpoch(millis);
    } catch (_) {
      return null;
    }
  }

  static Future<void> markChecked() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setInt(_lastCheckedKey, DateTime.now().millisecondsSinceEpoch);
    } catch (_) {
      // Non-fatal.
    }
  }
}
