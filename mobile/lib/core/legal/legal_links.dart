/// Canonical public URLs for FinPro's legal pages.
///
/// These are the verified production web URLs. The Android app must never
/// invent a domain or a placeholder: every link here is reachable without an
/// authenticated session, which is what Google Play requires for a privacy
/// policy and an account-deletion resource.
class LegalLinks {
  LegalLinks._();

  /// Production web deployment (Vercel) that serves `frontend/public`.
  static const String webBaseUrl = 'https://fin-pro-wheat.vercel.app';

  static const String privacyPolicy = '$webBaseUrl/privacy.html';
  static const String termsOfService = '$webBaseUrl/terms.html';
  static const String accountDeletion = '$webBaseUrl/delete-account.html';

  /// Verified public support channel. No private email address is published.
  static const String supportIssues =
      'https://github.com/tani1290/Finance_assistant/issues';

  /// Must match the effective date printed in the hosted policy.
  static const String privacyEffectiveDate = 'October 24, 2026';

  /// All external links the app may open. Used by tests to ensure no
  /// placeholder or non-HTTPS destination ships in the release build.
  static const List<String> all = <String>[
    privacyPolicy,
    termsOfService,
    accountDeletion,
    supportIssues,
  ];
}
