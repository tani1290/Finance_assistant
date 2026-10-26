import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/sms/sms_consent.dart';
import '../../core/sms/sms_platform_channel.dart';
import '../../shared/widgets/financial_card.dart';
import '../../shared/widgets/gradient_button.dart';

/// Privacy & Permissions screen.
///
/// Google Play's SMS policy requires a prominent in-app disclosure that is
/// shown *before* the runtime permission request, an affirmative user action
/// (not a pre-ticked switch), and normal app operation when SMS access is
/// refused. This screen therefore never requests the permission on entry: the
/// switch starts off, and enabling it opens an explicit disclosure dialog.
class PrivacyPermissionsScreen extends StatefulWidget {
  const PrivacyPermissionsScreen({super.key});

  @override
  State<PrivacyPermissionsScreen> createState() =>
      _PrivacyPermissionsScreenState();
}

class _PrivacyPermissionsScreenState extends State<PrivacyPermissionsScreen> {
  bool _smsDetectionEnabled = false;
  bool _permissionGranted = false;
  SmsConsentStatus _consent = SmsConsentStatus.unknown;
  bool _isLoading = true;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _loadState();
  }

  Future<void> _loadState() async {
    final granted = await SmsPlatformChannel.checkPermission();
    final prefEnabled = await SmsPlatformChannel.isDetectionEnabled();
    final consent = await const SmsConsentStore().read();

    if (!mounted) return;
    setState(() {
      _permissionGranted = granted;
      _consent = consent;
      // Detection only reads as on when both the OS permission and the stored
      // user preference are true. A failure in either lookup resolves to off.
      _smsDetectionEnabled = granted && prefEnabled;
      _isLoading = false;
    });
  }

  Future<void> _toggleDetection(bool enable) async {
    if (_busy) return;
    if (enable) {
      await _requestEnable();
    } else {
      await _disable();
    }
  }

  /// Shows the prominent disclosure and only proceeds on an explicit tap.
  Future<void> _requestEnable() async {
    final agreed = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => _SmsDisclosureDialog(
        alreadyGranted: _permissionGranted,
      ),
    );

    if (!mounted) return;

    if (agreed != true) {
      // An explicit refusal is persisted so the app does not keep asking.
      final stored = await const SmsConsentStore().write(
        SmsConsentStatus.declined,
      );
      if (!mounted) return;
      setState(() => _consent = stored ? SmsConsentStatus.declined : _consent);
      _showSnack(
        'SMS detection stays off. You can enable it anytime from here.',
        AppColors.warning,
      );
      return;
    }

    setState(() => _busy = true);

    final consentStored = await const SmsConsentStore().write(
      SmsConsentStatus.accepted,
    );

    var granted = _permissionGranted;
    if (!granted) {
      granted = await SmsPlatformChannel.requestPermission();
    }

    if (!granted) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _permissionGranted = false;
        _smsDetectionEnabled = false;
        _consent = consentStored
            ? SmsConsentStatus.accepted
            : SmsConsentStatus.unknown;
      });
      _showSnack(
        'Android did not grant SMS access. FinPro still works without it — '
        'you can add transactions manually.',
        AppColors.warning,
      );
      return;
    }

    final stored = await SmsPlatformChannel.setDetectionEnabled(true);

    if (!mounted) return;
    setState(() {
      _busy = false;
      _permissionGranted = true;
      _smsDetectionEnabled = stored;
      _consent = consentStored
          ? SmsConsentStatus.accepted
          : SmsConsentStatus.unknown;
    });

    if (stored) {
      _showSnack('SMS detection is on.', AppColors.primary);
    } else {
      _showSnack(
        'SMS detection could not be enabled on this device. FinPro still works '
        'without it.',
        AppColors.expense,
      );
    }
  }

  Future<void> _disable() async {
    setState(() => _busy = true);
    final stored = await SmsPlatformChannel.setDetectionEnabled(false);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _smsDetectionEnabled = stored ? false : _smsDetectionEnabled;
    });
    _showSnack(
      stored
          ? 'SMS detection paused. FinPro works normally without it.'
          : 'SMS detection could not be paused. Please try again.',
      stored ? AppColors.warning : AppColors.expense,
    );
  }

  void _showSnack(String message, Color color) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: color),
    );
  }

  String get _statusLine {
    if (_isLoading) return 'Checking this device…';
    if (_smsDetectionEnabled) {
      return 'On: FinPro may read incoming bank and payment SMS to suggest '
          'transactions for your review.';
    }
    if (_consent == SmsConsentStatus.declined) {
      return 'Off. You previously declined SMS access. FinPro works normally '
          'with manual entry.';
    }
    if (_permissionGranted) {
      return 'Off. Android permission is granted, but detection is paused.';
    }
    return 'Off. FinPro works normally with manual entry.';
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(title: const Text('Privacy & Permissions')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            FinancialCard(
              padding: const EdgeInsets.all(22),
              child: Column(
                children: [
                  Container(
                    width: 56,
                    height: 56,
                    decoration: BoxDecoration(
                      color: AppColors.primary.withValues(alpha: 0.12),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.shield_outlined,
                      size: 28,
                      color: AppColors.primaryLight,
                    ),
                  ),
                  const SizedBox(height: 14),
                  const Text(
                    'Your data, your choice',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'FinPro works fully without SMS access. Bank SMS detection '
                    'is optional and off by default.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 13,
                      color: AppColors.textSecondary(isDark),
                      height: 1.5,
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextButton.icon(
                    onPressed: () => context.push('/privacy-policy'),
                    icon: const Icon(Icons.policy_outlined, size: 16),
                    label: const Text('Read the privacy policy'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            FinancialCard(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Expanded(
                        child: Text(
                          'Bank SMS detection',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      Switch(
                        value: _smsDetectionEnabled,
                        onChanged: (_isLoading || _busy)
                            ? null
                            : _toggleDetection,
                        activeThumbColor: AppColors.primaryLight,
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _statusLine,
                    style: TextStyle(
                      fontSize: 13,
                      color: _smsDetectionEnabled
                          ? AppColors.primaryLight
                          : AppColors.textSecondary(isDark),
                      height: 1.45,
                    ),
                  ),
                  if (_consent == SmsConsentStatus.declined &&
                      !_smsDetectionEnabled) ...[
                    const SizedBox(height: 10),
                    Text(
                      'You declined the disclosure. FinPro will not ask again '
                      'unless you turn this on yourself.',
                      style: TextStyle(
                        fontSize: 11.5,
                        height: 1.4,
                        color: AppColors.textMuted(isDark),
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 20),

            const Text(
              'What FinPro does with SMS',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 12),
            _buildSecurityPoint(
              isDark,
              Icons.visibility_off_outlined,
              'One-time, on-device filtering',
              'Only incoming bank and payment messages are considered. OTPs, '
                  'promotional messages, payment requests, failed transactions '
                  'and balance-only alerts are discarded on the device.',
            ),
            const SizedBox(height: 10),
            _buildSecurityPoint(
              isDark,
              Icons.upload_outlined,
              'Only relevant text leaves the device',
              'A potentially relevant message is sent to FinPro to propose a '
                  'transaction. The server stores the parsed amount, merchant, '
                  'sender, timestamp and a one-way message hash — not the full '
                  'message body as a transaction.',
            ),
            const SizedBox(height: 10),
            _buildSecurityPoint(
              isDark,
              Icons.fact_check_outlined,
              'You approve every transaction',
              'Suggestions wait in the Pending SMS queue until you confirm '
                  'them. Nothing is posted to your ledger automatically.',
            ),
            const SizedBox(height: 10),
            _buildSecurityPoint(
              isDark,
              Icons.password_rounded,
              'No credentials, no OTPs',
              'FinPro never asks for NetBanking passwords, UPI PINs or full '
                  'card numbers, and never stores authentication codes.',
            ),
            const SizedBox(height: 10),
            _buildSecurityPoint(
              isDark,
              Icons.toggle_off_outlined,
              'Turn it off anytime',
              'Switching this off stops the receiver from processing messages. '
                  'You can also revoke the Android permission in system '
                  'settings.',
            ),
            const SizedBox(height: 28),

            if (!_smsDetectionEnabled)
              GradientButton(
                text: _isLoading
                    ? 'Checking this device…'
                    : 'Enable bank SMS detection',
                icon: Icons.sms_rounded,
                isLoading: _busy,
                onPressed: _isLoading ? null : () => _toggleDetection(true),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildSecurityPoint(
    bool isDark,
    IconData icon,
    String title,
    String desc,
  ) {
    return FinancialCard(
      padding: const EdgeInsets.all(16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(icon, color: AppColors.primaryLight, size: 18),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 13.5,
                    color: AppColors.textPrimary(isDark),
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  desc,
                  style: TextStyle(
                    fontSize: 12,
                    color: AppColors.textSecondary(isDark),
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Prominent disclosure shown before the Android SMS runtime permission.
///
/// Returns `true` only when the user taps the affirmative button. Dismissing
/// (back button / outside tap is disabled) or "Not now" returns `false`.
class _SmsDisclosureDialog extends StatelessWidget {
  final bool alreadyGranted;

  const _SmsDisclosureDialog({required this.alreadyGranted});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return AlertDialog(
      title: const Text('Allow FinPro to read bank SMS?'),
      content: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              alreadyGranted
                  ? 'Android has already granted SMS access. Turning this on '
                        'lets FinPro process incoming bank and payment messages '
                        'to suggest transactions.'
                  : 'Android will now ask for permission to receive SMS. FinPro '
                        'uses it only to detect bank and payment messages and '
                        'suggest transactions you review.',
              style: TextStyle(
                fontSize: 13,
                height: 1.5,
                color: AppColors.textSecondary(isDark),
              ),
            ),
            const SizedBox(height: 12),
            Text(
              '• OTPs, promotions, payment requests and balance-only messages '
              'are discarded on your device.\n'
              '• Relevant message text is sent to FinPro for parsing; the full '
              'body is not stored as a transaction.\n'
              '• Nothing is added to your ledger without your confirmation.\n'
              '• You can turn this off anytime, and the app works normally '
              'without it.',
              style: TextStyle(
                fontSize: 12.5,
                height: 1.55,
                color: AppColors.textSecondary(isDark),
              ),
            ),
            const SizedBox(height: 12),
            Text(
              'Read the full policy at /privacy-policy.',
              style: TextStyle(
                fontSize: 11.5,
                height: 1.4,
                color: AppColors.textMuted(isDark),
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Not now'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(true),
          child: Text(alreadyGranted ? 'Turn on' : 'Agree & continue'),
        ),
      ],
    );
  }
}
