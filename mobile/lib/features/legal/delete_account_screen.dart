import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/auth/auth_notifier.dart';
import '../../core/legal/legal_links.dart';
import '../../shared/widgets/financial_card.dart';
import '../../shared/widgets/gradient_button.dart';

/// Permanently deletes the signed-in FinPro application account.
///
/// This is intentionally not the same thing as deleting a financial account:
/// it removes the user record, all user-owned financial records, uploaded
/// files, push tokens, and sessions. The screen requires an exact `DELETE`
/// confirmation plus an acknowledgement, and asks for the current password
/// when the account has one.
class DeleteAccountScreen extends ConsumerStatefulWidget {
  const DeleteAccountScreen({super.key});

  @override
  ConsumerState<DeleteAccountScreen> createState() =>
      _DeleteAccountScreenState();
}

class _DeleteAccountScreenState extends ConsumerState<DeleteAccountScreen> {
  final _passwordController = TextEditingController();
  final _confirmationController = TextEditingController();
  bool _acknowledged = false;
  bool _isDeleting = false;
  String? _error;

  @override
  void dispose() {
    _passwordController.dispose();
    _confirmationController.dispose();
    super.dispose();
  }

  bool get _canSubmit {
    return !_isDeleting &&
        _acknowledged &&
        _confirmationController.text.trim() == 'DELETE';
  }

  Future<void> _handleDelete() async {
    FocusScope.of(context).unfocus();

    if (_confirmationController.text.trim() != 'DELETE') {
      setState(() => _error = 'Type DELETE exactly to confirm.');
      return;
    }
    if (!_acknowledged) {
      setState(() => _error = 'Acknowledge that deletion cannot be undone.');
      return;
    }

    setState(() {
      _isDeleting = true;
      _error = null;
    });

    // Capture the notifier before navigating away so the final local cleanup
    // still runs after this screen is disposed.
    final notifier = ref.read(authProvider.notifier);
    final password = _passwordController.text;

    final error = await notifier.deleteAccount(
      password: password.isEmpty ? null : password,
    );

    if (!mounted) return;

    if (error != null) {
      setState(() {
        _isDeleting = false;
        _error = error;
      });
      return;
    }

    HapticFeedback.heavyImpact();
    // The success route is public, so navigating before the auth state is
    // cleared cannot race the guard into redirecting to /login.
    context.go('/account-deleted');
    await notifier.finalizeAccountDeletion();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(title: const Text('Delete account')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            FinancialCard(
              padding: const EdgeInsets.all(18),
              border: Border.all(
                color: AppColors.expense.withValues(alpha: 0.35),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(9),
                        decoration: BoxDecoration(
                          color: AppColors.expense.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: const Icon(
                          Icons.warning_amber_rounded,
                          color: AppColors.expense,
                          size: 20,
                        ),
                      ),
                      const SizedBox(width: 12),
                      const Expanded(
                        child: Text(
                          'This permanently deletes your FinPro account',
                          style: TextStyle(
                            fontSize: 14.5,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'Deletion cannot be undone and there is no recovery period. '
                    'Export anything you want to keep before continuing.',
                    style: TextStyle(
                      fontSize: 12.5,
                      height: 1.5,
                      color: AppColors.textSecondary(isDark),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),

            FinancialCard(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'What is deleted',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary(isDark),
                    ),
                  ),
                  const SizedBox(height: 10),
                  for (final item in const [
                    'Your profile, email, username, and password hash.',
                    'Financial accounts, transactions, budgets, goals, investments, loans, insurance, subscriptions, cards, calendar events, and tasks.',
                    'AI conversations, recommendations, receipt scans, and export files.',
                    'Uploaded files in FinPro storage, push tokens, device records, pending SMS suggestions, refresh sessions, and audit records.',
                  ])
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Padding(
                            padding: const EdgeInsets.only(top: 6),
                            child: Container(
                              width: 4,
                              height: 4,
                              decoration: BoxDecoration(
                                color: AppColors.expense,
                                shape: BoxShape.circle,
                              ),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              item,
                              style: TextStyle(
                                fontSize: 12.5,
                                height: 1.5,
                                color: AppColors.textSecondary(isDark),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  Text(
                    'If storage cleanup fails, the deletion stops and your account '
                    'is left intact so you can retry.',
                    style: TextStyle(
                      fontSize: 11.5,
                      height: 1.45,
                      color: AppColors.textMuted(isDark),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),

            FinancialCard(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Confirm deletion',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary(isDark),
                    ),
                  ),
                  const SizedBox(height: 14),
                  Text(
                    'Current password',
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textPrimary(isDark),
                    ),
                  ),
                  const SizedBox(height: 6),
                  TextField(
                    controller: _passwordController,
                    obscureText: true,
                    enabled: !_isDeleting,
                    textInputAction: TextInputAction.next,
                    decoration: const InputDecoration(
                      hintText: 'Enter your current password',
                      prefixIcon: Icon(Icons.lock_outline_rounded, size: 20),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Required for password-based accounts. Leave blank only if '
                    'your account has no FinPro password.',
                    style: TextStyle(
                      fontSize: 11.5,
                      height: 1.4,
                      color: AppColors.textMuted(isDark),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'Type DELETE to confirm',
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textPrimary(isDark),
                    ),
                  ),
                  const SizedBox(height: 6),
                  TextField(
                    controller: _confirmationController,
                    enabled: !_isDeleting,
                    autocorrect: false,
                    enableSuggestions: false,
                    textCapitalization: TextCapitalization.characters,
                    onChanged: (_) => setState(() {}),
                    decoration: const InputDecoration(
                      hintText: 'DELETE',
                      prefixIcon: Icon(Icons.keyboard_rounded, size: 20),
                    ),
                  ),
                  const SizedBox(height: 14),
                  CheckboxListTile(
                    value: _acknowledged,
                    onChanged: _isDeleting
                        ? null
                        : (value) =>
                              setState(() => _acknowledged = value ?? false),
                    contentPadding: EdgeInsets.zero,
                    controlAffinity: ListTileControlAffinity.leading,
                    title: Text(
                      'I understand that my account and all associated data will '
                      'be permanently deleted and cannot be recovered.',
                      style: TextStyle(
                        fontSize: 12.5,
                        height: 1.4,
                        color: AppColors.textSecondary(isDark),
                      ),
                    ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppColors.expense.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          color: AppColors.expense.withValues(alpha: 0.3),
                        ),
                      ),
                      child: Text(
                        _error!,
                        style: const TextStyle(
                          fontSize: 12.5,
                          color: AppColors.expense,
                          height: 1.4,
                        ),
                      ),
                    ),
                  ],
                  const SizedBox(height: 18),
                  GradientButton(
                    text: 'Permanently delete my account',
                    icon: Icons.delete_forever_rounded,
                    isLoading: _isDeleting,
                    onPressed: _canSubmit ? _handleDelete : null,
                  ),
                  const SizedBox(height: 12),
                  Center(
                    child: TextButton(
                      onPressed: _isDeleting
                          ? null
                          : () => context.pop(),
                      child: const Text('Cancel'),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Text(
              'You can also read how deletion works on the public web page: '
              '${LegalLinks.accountDeletion}',
              style: TextStyle(
                fontSize: 11,
                height: 1.45,
                color: AppColors.textMuted(isDark),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
