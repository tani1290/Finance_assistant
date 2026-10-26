import 'package:flutter/services.dart';

/// Opens an external URL through the host platform.
///
/// The app deliberately avoids bundling a browser/WebView dependency for a
/// handful of legal links. Android exposes a tiny `com.finpro.app/platform`
/// channel instead, and this wrapper returns `false` whenever the platform
/// cannot handle the request so callers can fall back to showing the URL for
/// manual copy.
class ExternalLink {
  ExternalLink._();

  static const MethodChannel _channel = MethodChannel(
    'com.finpro.app/platform',
  );

  /// Returns `true` only when the platform accepted the URL.
  ///
  /// Only absolute `http`/`https` URLs are forwarded; anything else is
  /// rejected locally so a malformed constant cannot launch an arbitrary
  /// intent.
  static Future<bool> open(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null || !uri.hasScheme) return false;
    if (uri.scheme != 'https' && uri.scheme != 'http') return false;
    if (uri.host.isEmpty) return false;

    try {
      final opened = await _channel.invokeMethod<bool>('openUrl', {
        'url': uri.toString(),
      });
      return opened ?? false;
    } catch (_) {
      return false;
    }
  }
}
