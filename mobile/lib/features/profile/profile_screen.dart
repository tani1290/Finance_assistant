import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/api/api_error.dart';
import '../../core/auth/auth_notifier.dart';
import '../../core/models/user_model.dart';
import '../../core/models/user_profile_model.dart';
import '../../core/utils/date_formatter.dart';
import '../../shared/widgets/error_state_view.dart';
import '../../shared/widgets/financial_card.dart';
import '../../shared/widgets/gradient_button.dart';
import '../../shared/widgets/skeleton_loader.dart';

/// The three risk profiles the backend accepts for `financialProfile`.
/// Labels mirror the web profile form.
const List<(String value, String label, String hint)> _riskOptions = [
  ('CONSERVATIVE', 'Conservative', 'Low risk'),
  ('MODERATE', 'Moderate', 'Balanced'),
  ('AGGRESSIVE', 'Aggressive', 'Growth'),
];

/// View and edit the signed-in user's profile.
///
/// Identity (`email`, `username`) is displayed read-only because the backend
/// `PATCH /auth/profile` contract does not accept those fields. Only the
/// server-supported fields are editable and only *changed* fields are sent, so
/// the request can never clobber a value the user did not touch.
class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  final _formKey = GlobalKey<FormState>();

  final _firstName = TextEditingController();
  final _lastName = TextEditingController();
  final _occupation = TextEditingController();
  final _city = TextEditingController();
  final _bio = TextEditingController();
  final _salary = TextEditingController();
  final _expenses = TextEditingController();

  String _riskProfile = 'MODERATE';

  bool _isLoading = true;
  String? _errorMessage;

  /// The last server-confirmed profile; doubles as the dirty-comparison base.
  UserProfileModel? _profile;

  bool _isSaving = false;
  String? _saveError;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _firstName.dispose();
    _lastName.dispose();
    _occupation.dispose();
    _city.dispose();
    _bio.dispose();
    _salary.dispose();
    _expenses.dispose();
    super.dispose();
  }

  double _parseAmount(String text) =>
      double.tryParse(text.trim().replaceAll(',', '')) ?? 0;

  double get _salaryValue => _parseAmount(_salary.text);
  double get _expensesValue => _parseAmount(_expenses.text);

  bool get _isDirty {
    final original = _profile;
    if (original == null) return false;
    return _firstName.text.trim() != original.firstName ||
        _lastName.text.trim() != original.lastName ||
        _occupation.text.trim() != (original.occupation ?? '') ||
        _bio.text.trim() != (original.bio ?? '') ||
        _city.text.trim() != (original.city ?? '') ||
        _salaryValue != (original.monthlySalary ?? 0) ||
        _expensesValue != (original.estimatedMonthlyExpenses ?? 0) ||
        _riskProfile != (original.riskProfile ?? 'MODERATE');
  }

  void _populate(UserProfileModel profile) {
    _firstName.text = profile.firstName;
    _lastName.text = profile.lastName;
    _occupation.text = profile.occupation ?? '';
    _city.text = profile.city ?? '';
    _bio.text = profile.bio ?? '';
    _salary.text = _amountToText(profile.monthlySalary);
    _expenses.text = _amountToText(profile.estimatedMonthlyExpenses);
    _riskProfile = profile.riskProfile ?? 'MODERATE';
  }

  static String _amountToText(double? value) {
    if (value == null) return '0';
    if (value == value.roundToDouble()) return value.toStringAsFixed(0);
    return value.toStringAsFixed(2);
  }

  Future<void> _load({bool showSkeleton = true}) async {
    if (showSkeleton) {
      setState(() {
        _isLoading = true;
      });
    }
    setState(() {
      _errorMessage = null;
      _saveError = null;
    });

    try {
      final res = await apiClient.get(ApiEndpoints.me);

      if (res.statusCode == 200 &&
          res.data['success'] == true &&
          res.data['data'] is Map) {
        final profile = UserProfileModel.fromJson(
          Map<String, dynamic>.from(res.data['data'] as Map),
        );
        if (!mounted) return;
        setState(() {
          _profile = profile;
          _populate(profile);
          _isLoading = false;
        });
      } else {
        if (!mounted) return;
        setState(() {
          _errorMessage = 'The server returned an unexpected response.';
          _isLoading = false;
        });
      }
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _errorMessage =
            apiErrorMessage(error) ??
            'Your profile could not be loaded. Check your connection and try again.';
        _isLoading = false;
      });
    }
  }

  Future<void> _save() async {
    // The button is disabled in flight, but the guard also covers a same-frame
    // double tap so a single edit can never produce two PATCH requests.
    if (_isSaving) return;
    final original = _profile;
    if (original == null) return;
    if (!(_formKey.currentState?.validate() ?? false)) return;

    final firstName = _firstName.text.trim();
    final lastName = _lastName.text.trim();
    final occupation = _occupation.text.trim();
    final bio = _bio.text.trim();
    final city = _city.text.trim();

    // Only send fields the user actually changed. The backend updates a field
    // only when it is present in the body (`!== undefined`), so omitting
    // untouched fields preserves them exactly.
    final payload = <String, dynamic>{};
    if (firstName != original.firstName) payload['firstName'] = firstName;
    if (lastName != original.lastName) payload['lastName'] = lastName;
    if (occupation != (original.occupation ?? '')) {
      payload['occupation'] = occupation;
    }
    if (bio != (original.bio ?? '')) payload['bio'] = bio;
    if (city != (original.city ?? '')) payload['city'] = city;
    if (_salaryValue != (original.monthlySalary ?? 0)) {
      payload['monthlySalary'] = _salaryValue;
    }
    if (_expensesValue != (original.estimatedMonthlyExpenses ?? 0)) {
      payload['estimatedMonthlyExpenses'] = _expensesValue;
    }
    if (_riskProfile != (original.riskProfile ?? 'MODERATE')) {
      payload['riskProfile'] = _riskProfile;
    }

    if (payload.isEmpty) return;

    setState(() {
      _isSaving = true;
      _saveError = null;
    });

    try {
      final res = await apiClient.patch(ApiEndpoints.profile, data: payload);

      if (res.statusCode == 200 &&
          res.data['success'] == true &&
          res.data['data'] is Map) {
        final updated = UserProfileModel.fromJson(
          Map<String, dynamic>.from(res.data['data'] as Map),
        );

        // Keep the shell's cached identity in step with the saved name.
        ref
            .read(authProvider.notifier)
            .updateUser(
              UserModel(
                id: updated.id,
                email: updated.email,
                username: updated.username,
                firstName: updated.firstName,
                lastName: updated.lastName,
                currency: updated.currency,
                isPremium: updated.isPremium,
              ),
            );

        if (!mounted) return;
        setState(() {
          _profile = updated;
          _populate(updated);
          _isSaving = false;
        });

        final confirmation = serverMessage(res.data) ?? 'Profile updated.';
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(confirmation)));

        // Re-read from the server so the form reflects the persisted truth
        // (the endpoint's own response is reliable, but a follow-up read also
        // catches any field the server normalised).
        await _load(showSkeleton: false);
      } else {
        if (!mounted) return;
        setState(() {
          _saveError = 'The server returned an unexpected response.';
          _isSaving = false;
        });
      }
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _saveError =
            apiErrorMessage(error) ??
            'Your changes could not be saved. Check your connection and try again.';
        _isSaving = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Profile'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _isSaving ? null : _load,
          ),
        ],
      ),
      body: _isLoading
          ? _buildSkeleton()
          : _errorMessage != null
          ? ErrorStateView(message: _errorMessage!, onRetry: _load)
          : _buildForm(isDark),
    );
  }

  Widget _buildSkeleton() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
      children: const [
        SkeletonLoader(width: double.infinity, height: 96, borderRadius: 18),
        SizedBox(height: 20),
        SkeletonLoader(width: double.infinity, height: 76, borderRadius: 12),
        SizedBox(height: 12),
        SkeletonLoader(width: double.infinity, height: 76, borderRadius: 12),
        SizedBox(height: 12),
        SkeletonLoader(width: double.infinity, height: 76, borderRadius: 12),
      ],
    );
  }

  Widget _buildForm(bool isDark) {
    final profile = _profile;
    if (profile == null) {
      return const SizedBox.shrink();
    }

    return Form(
      key: _formKey,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 40),
        children: [
          _buildIdentityCard(isDark, profile),
          const SizedBox(height: 24),

          _SectionLabel('Account', isDark: isDark),
          FinancialCard(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                _readOnlyTile(
                  isDark,
                  icon: Icons.mail_outline_rounded,
                  label: 'Email',
                  value: profile.email,
                ),
                Divider(height: 1, color: AppColors.border(isDark)),
                _readOnlyTile(
                  isDark,
                  icon: Icons.alternate_email_rounded,
                  label: 'Username',
                  value: profile.username.isEmpty ? '—' : profile.username,
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          _Hint(
            isDark: isDark,
            text:
                'Email and username are managed by your account and cannot be '
                'changed here.',
          ),
          const SizedBox(height: 22),

          _SectionLabel('Personal details', isDark: isDark),
          FinancialCard(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _field(
                  isDark: isDark,
                  controller: _firstName,
                  label: 'First name',
                  hint: 'e.g. Aarav',
                  textCapitalization: TextCapitalization.words,
                  validator: (value) => (value ?? '').trim().length > 60
                      ? 'Keep it under 60 characters.'
                      : null,
                ),
                const SizedBox(height: 16),
                _field(
                  isDark: isDark,
                  controller: _lastName,
                  label: 'Last name',
                  hint: 'e.g. Sharma',
                  textCapitalization: TextCapitalization.words,
                  validator: (value) => (value ?? '').trim().length > 60
                      ? 'Keep it under 60 characters.'
                      : null,
                ),
                const SizedBox(height: 16),
                _field(
                  isDark: isDark,
                  controller: _occupation,
                  label: 'Occupation',
                  hint: 'e.g. Software Engineer',
                  textCapitalization: TextCapitalization.words,
                ),
                const SizedBox(height: 16),
                _field(
                  isDark: isDark,
                  controller: _city,
                  label: 'City',
                  hint: 'e.g. Mumbai',
                  textCapitalization: TextCapitalization.words,
                ),
                const SizedBox(height: 16),
                _field(
                  isDark: isDark,
                  controller: _bio,
                  label: 'Bio',
                  hint: 'A short line about you',
                  maxLines: 3,
                  textCapitalization: TextCapitalization.sentences,
                ),
              ],
            ),
          ),
          const SizedBox(height: 22),

          _SectionLabel('Financial profile', isDark: isDark),
          FinancialCard(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _amountField(
                  isDark: isDark,
                  controller: _salary,
                  label: 'Monthly salary',
                  hint: 'Take-home amount',
                ),
                const SizedBox(height: 16),
                _amountField(
                  isDark: isDark,
                  controller: _expenses,
                  label: 'Estimated monthly expenses',
                  hint: 'Your typical monthly spend',
                ),
                const SizedBox(height: 20),
                Text(
                  'Risk tolerance',
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textSecondary(isDark),
                  ),
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final option in _riskOptions)
                      _riskChip(isDark, option.$1, option.$2, option.$3),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),

          if (_saveError != null) ...[
            _ErrorBanner(message: _saveError!),
            const SizedBox(height: 16),
          ],

          GradientButton(
            text: _isSaving ? 'Saving…' : 'Save changes',
            icon: Icons.check_rounded,
            isLoading: _isSaving,
            onPressed: (_isSaving || !_isDirty) ? null : _save,
          ),
          if (!_isDirty && !_isSaving) ...[
            const SizedBox(height: 10),
            Center(
              child: Text(
                'No unsaved changes.',
                style: TextStyle(
                  fontSize: 12,
                  color: AppColors.textMuted(isDark),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildIdentityCard(bool isDark, UserProfileModel profile) {
    final initial = profile.firstName.isNotEmpty
        ? profile.firstName[0].toUpperCase()
        : (profile.username.isNotEmpty
              ? profile.username[0].toUpperCase()
              : 'F');

    return FinancialCard(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 60,
                height: 60,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: AppColors.primaryGradient,
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(18),
                  boxShadow: AppColors.glow(AppColors.primary, strength: 0.5),
                ),
                alignment: Alignment.center,
                child: Text(
                  initial,
                  style: const TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                  ),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      profile.fullName,
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary(isDark),
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      profile.email,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 13,
                        color: AppColors.textSecondary(isDark),
                      ),
                    ),
                  ],
                ),
              ),
              if (profile.isPremium)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: AppColors.premiumGradient,
                    ),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Text(
                    'PREMIUM',
                    style: TextStyle(
                      fontSize: 9.5,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.6,
                      color: Colors.white,
                    ),
                  ),
                ),
            ],
          ),
          if (profile.createdAt != null) ...[
            const SizedBox(height: 14),
            Text(
              'Member since ${DateFormatter.format(profile.createdAt)}',
              style: TextStyle(
                fontSize: 12,
                color: AppColors.textMuted(isDark),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _readOnlyTile(
    bool isDark, {
    required IconData icon,
    required String label,
    required String value,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(9),
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: AppColors.primaryLight, size: 19),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 14,
                    color: AppColors.textPrimary(isDark),
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12,
                    color: AppColors.textSecondary(isDark),
                  ),
                ),
              ],
            ),
          ),
          Icon(
            Icons.lock_outline_rounded,
            size: 16,
            color: AppColors.textMuted(isDark),
          ),
        ],
      ),
    );
  }

  Widget _field({
    required bool isDark,
    required TextEditingController controller,
    required String label,
    required String hint,
    int maxLines = 1,
    TextCapitalization textCapitalization = TextCapitalization.none,
    String? Function(String?)? validator,
  }) {
    return TextFormField(
      controller: controller,
      maxLines: maxLines,
      textCapitalization: textCapitalization,
      autovalidateMode: AutovalidateMode.onUserInteraction,
      validator: validator,
      // Re-evaluate `_isDirty` on every keystroke so the save button enables
      // as soon as the form diverges from the server copy.
      onChanged: (_) => setState(() {}),
      style: TextStyle(fontSize: 14, color: AppColors.textPrimary(isDark)),
      decoration: InputDecoration(labelText: label, hintText: hint),
    );
  }

  Widget _amountField({
    required bool isDark,
    required TextEditingController controller,
    required String label,
    required String hint,
  }) {
    return TextFormField(
      controller: controller,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
      autovalidateMode: AutovalidateMode.onUserInteraction,
      onChanged: (_) => setState(() {}),
      validator: (value) {
        final text = (value ?? '').trim();
        if (text.isEmpty) return null;
        final parsed = double.tryParse(text.replaceAll(',', ''));
        if (parsed == null) return 'Enter a valid amount.';
        if (parsed < 0) return 'Amount cannot be negative.';
        return null;
      },
      style: TextStyle(fontSize: 14, color: AppColors.textPrimary(isDark)),
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        prefixText: '₹ ',
      ),
    );
  }

  Widget _riskChip(bool isDark, String value, String label, String hint) {
    final selected = _riskProfile == value;

    return ChoiceChip(
      selected: selected,
      onSelected: (_) {
        HapticFeedback.selectionClick();
        setState(() => _riskProfile = value);
      },
      label: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: selected
                  ? AppColors.primaryLight
                  : AppColors.textPrimary(isDark),
            ),
          ),
          Text(
            hint,
            style: TextStyle(
              fontSize: 10.5,
              color: AppColors.textMuted(isDark),
            ),
          ),
        ],
      ),
      showCheckmark: false,
    );
  }
}

class _SectionLabel extends StatelessWidget {
  final String label;
  final bool isDark;

  const _SectionLabel(this.label, {required this.isDark});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 4, bottom: 10),
      child: Align(
        alignment: Alignment.centerLeft,
        child: Text(
          label.toUpperCase(),
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.9,
            color: AppColors.textMuted(isDark),
          ),
        ),
      ),
    );
  }
}

class _Hint extends StatelessWidget {
  final bool isDark;
  final String text;

  const _Hint({required this.isDark, required this.text});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 11.5,
          height: 1.4,
          color: AppColors.textMuted(isDark),
        ),
      ),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  final String message;

  const _ErrorBanner({required this.message});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.expense.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.expense.withValues(alpha: 0.35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.error_outline_rounded,
            size: 18,
            color: AppColors.expense,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                fontSize: 12.5,
                height: 1.4,
                color: AppColors.expense,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
