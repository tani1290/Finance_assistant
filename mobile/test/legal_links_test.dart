import 'package:finpro_mobile/core/legal/legal_links.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('LegalLinks', () {
    test('every published link is absolute HTTPS', () {
      expect(LegalLinks.all, isNotEmpty);
      for (final url in LegalLinks.all) {
        final uri = Uri.tryParse(url);
        expect(uri, isNotNull, reason: '$url must parse');
        expect(uri!.scheme, 'https', reason: '$url must use HTTPS');
        expect(uri.host, isNotEmpty, reason: '$url must have a host');
      }
    });

    test('links target the verified production web deployment', () {
      const base = 'https://fin-pro-wheat.vercel.app';
      expect(LegalLinks.webBaseUrl, base);
      for (final url in [
        LegalLinks.privacyPolicy,
        LegalLinks.termsOfService,
        LegalLinks.accountDeletion,
      ]) {
        expect(url, startsWith('$base/'));
      }
    });

    test('contains no placeholder or local destinations', () {
      const forbidden = [
        'example.com',
        'localhost',
        '127.0.0.1',
        'TODO',
        'your-domain',
        'placeholder',
      ];
      for (final url in LegalLinks.all) {
        final lower = url.toLowerCase();
        for (final token in forbidden) {
          expect(
            lower,
            isNot(contains(token)),
            reason: '$url must not ship with "$token"',
          );
        }
      }
    });

    test('policy and support endpoints are the documented ones', () {
      expect(LegalLinks.privacyPolicy, endsWith('/privacy.html'));
      expect(LegalLinks.termsOfService, endsWith('/terms.html'));
      expect(LegalLinks.accountDeletion, endsWith('/delete-account.html'));
      expect(
        LegalLinks.supportIssues,
        'https://github.com/tani1290/Finance_assistant/issues',
      );
      expect(LegalLinks.privacyEffectiveDate, 'October 24, 2026');
    });
  });
}
