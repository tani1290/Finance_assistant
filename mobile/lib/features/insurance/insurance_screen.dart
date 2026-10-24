import 'package:flutter/material.dart';

import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/api/api_error.dart';
import '../../core/models/insurance_policy_model.dart';
import '../../core/models/subscription_model.dart';
import '../../core/utils/currency_formatter.dart';
import '../../core/utils/date_formatter.dart';
import '../../shared/widgets/error_state_view.dart';
import '../../shared/widgets/financial_card.dart';
import '../../shared/widgets/section_header.dart';
import '../../shared/widgets/skeleton_loader.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/summary_hero_card.dart';
import 'add_policy_sheet.dart';
import 'add_subscription_sheet.dart';

/// Insurance and recurring subscriptions, mirroring the web `insurance.html`
/// page (which combines both) in a single mobile screen.
///
/// Two rules are worth noting because they mirror the backend exactly rather
/// than re-deriving them:
///
/// * The headline totals come from the server's own `summary` block when it is
///   present, so mobile and web never disagree on rounding. A client-side
///   recomputation from the list is used only as a fallback.
/// * The server's totals include every stored row, active or not, while the
///   "active" counts exclude inactive ones. The screen surfaces both numbers so
///   the distinction is visible instead of hidden. See `docs/` for the backlog
///   item that tracks tightening the server-side sum.
class InsuranceScreen extends StatefulWidget {
  const InsuranceScreen({super.key});

  @override
  State<InsuranceScreen> createState() => _InsuranceScreenState();
}

class _InsuranceScreenState extends State<InsuranceScreen> {
  bool _isLoading = true;
  String? _errorMessage;

  List<InsurancePolicyModel> _policies = [];
  InsuranceSummaryModel? _insuranceSummary;

  List<SubscriptionModel> _subscriptions = [];
  SubscriptionSummaryModel? _subscriptionSummary;

  /// `GET /ai/insurance-review` payload, or null when that call failed. The
  /// review is advisory, so its absence must never block the page.
  Map<String, dynamic>? _review;

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  Future<void> _fetch() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final responses = await Future.wait([
        apiClient.get(ApiEndpoints.insurance),
        apiClient.get(ApiEndpoints.subscriptions),
      ]);

      final insuranceData = _dataOf(responses[0]);
      final subscriptionData = _dataOf(responses[1]);

      final policies = _listOf(insuranceData?['policies'])
          .map((json) => InsurancePolicyModel.fromJson(json))
          .toList();
      final subscriptions = _listOf(subscriptionData?['subscriptions'])
          .map((json) => SubscriptionModel.fromJson(json))
          .toList();

      final insuranceSummary = insuranceData?['summary'];
      final subscriptionSummary = subscriptionData?['summary'];

      if (!mounted) return;
      setState(() {
        _policies = policies;
        _insuranceSummary = insuranceSummary is Map
            ? InsuranceSummaryModel.fromJson(
                Map<String, dynamic>.from(insuranceSummary),
              )
            : null;
        _subscriptions = subscriptions;
        _subscriptionSummary = subscriptionSummary is Map
            ? SubscriptionSummaryModel.fromJson(
                Map<String, dynamic>.from(subscriptionSummary),
              )
            : null;
        _isLoading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _errorMessage =
            apiErrorMessage(error) ??
            'Your insurance and subscriptions could not be loaded. Check your connection and try again.';
        _isLoading = false;
      });
      return;
    }

    await _loadReview();
  }

  /// Best-effort advisory review. Failures are swallowed: a rules-based summary
  /// is a bonus, not a prerequisite for the screen.
  Future<void> _loadReview() async {
    try {
      final res = await apiClient.get(ApiEndpoints.insuranceReview);
      final data = _dataOf(res);
      if (!mounted) return;
      setState(() => _review = data);
    } catch (_) {
      if (!mounted) return;
      setState(() => _review = null);
    }
  }

  Map<String, dynamic>? _dataOf(dynamic response) {
    final data = response.data;
    if (data is Map && data['success'] == true && data['data'] is Map) {
      return Map<String, dynamic>.from(data['data'] as Map);
    }
    return null;
  }

  List<Map<String, dynamic>> _listOf(dynamic value) {
    if (value is! List) return const [];
    return value
        .whereType<Map>()
        .map((json) => Map<String, dynamic>.from(json))
        .toList();
  }

  // ── Derived figures ───────────────────────────────────────────────────────

  /// Mirrors the backend formula, used only when the server summary is absent.
  double get _computedCoverage =>
      _policies.fold(0.0, (sum, p) => sum + p.coverageAmount);

  double get _computedAnnualPremium =>
      _policies.fold(0.0, (sum, p) => sum + p.annualPremium);

  double get _computedMonthlySubscription =>
      _subscriptions.fold(0.0, (sum, s) => sum + s.monthlyCost);

  String get _coverageLabel =>
      _insuranceSummary?.formattedTotalCoverage ??
      CurrencyFormatter.format(_computedCoverage);

  String get _annualPremiumLabel =>
      _insuranceSummary?.formattedAnnualPremium ??
      CurrencyFormatter.format(_computedAnnualPremium);

  String get _monthlySubscriptionLabel =>
      _subscriptionSummary?.formattedMonthlyTotal ??
      CurrencyFormatter.format(_computedMonthlySubscription);

  String get _annualSubscriptionLabel =>
      _subscriptionSummary?.formattedAnnualTotal ??
      CurrencyFormatter.format(_computedMonthlySubscription * 12);

  int get _policyCount => _insuranceSummary?.totalPolicies ?? _policies.length;

  int get _activePolicyCount =>
      _insuranceSummary?.activePolicies ??
      _policies.where((p) => p.isActive).length;

  int get _subscriptionCount =>
      _subscriptionSummary?.totalSubscriptions ?? _subscriptions.length;

  int get _activeSubscriptionCount =>
      _subscriptionSummary?.activeSubscriptions ??
      _subscriptions.where((s) => s.isActive).length;

  DateTime? get _nextRenewal {
    final serverValue = _insuranceSummary?.nextRenewal;
    if (serverValue != null) return serverValue;

    final now = DateTime.now();
    final upcoming = _policies
        .where((p) => p.isActive && !p.renewalDate.isBefore(now))
        .map((p) => p.renewalDate)
        .toList()
      ..sort();
    return upcoming.isEmpty ? null : upcoming.first;
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  Future<void> _openAddPolicy() async {
    await AddPolicySheet.show(
      context,
      onCreated: (message) => _afterMutation(message),
    );
  }

  Future<void> _openAddSubscription() async {
    await AddSubscriptionSheet.show(
      context,
      onCreated: (message) => _afterMutation(message),
    );
  }

  void _afterMutation(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
    _fetch();
  }

  Future<void> _confirmDelete({
    required String title,
    required String description,
    required String endpoint,
  }) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: Text(description),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    try {
      await apiClient.delete(endpoint);
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Deleted.')));
      _fetch();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            apiErrorMessage(error) ??
                'It could not be deleted. Check your connection.',
          ),
        ),
      );
    }
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Insurance & Recurring'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _fetch,
          ),
        ],
      ),
      body: _buildBody(isDark),
    );
  }

  Widget _buildBody(bool isDark) {
    if (_isLoading) return _buildSkeleton();

    if (_errorMessage != null) {
      return ErrorStateView(message: _errorMessage!, onRetry: _fetch);
    }

    return RefreshIndicator(
      onRefresh: _fetch,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 40),
        children: [
          SummaryHeroCard(
            label: 'Total Coverage',
            value: _coverageLabel,
            subtitle:
                '$_policyCount ${_policyCount == 1 ? 'policy' : 'policies'} · '
                '$_annualPremiumLabel annual premium',
            icon: Icons.shield_rounded,
          ),
          const SizedBox(height: 16),
          _buildMetricPills(isDark),
          const SizedBox(height: 24),
          SectionHeader(
            title: 'Insurance Policies',
            subtitle: '$_activePolicyCount of $_policyCount active',
            actionLabel: 'Add',
            actionIcon: Icons.add_rounded,
            onAction: _openAddPolicy,
          ),
          if (_policies.isEmpty)
            _InlineEmpty(
              isDark: isDark,
              icon: Icons.shield_outlined,
              message:
                  'No policies recorded yet. Add life, health or vehicle cover to track renewals here.',
            )
          else
            for (final policy in _policies)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: _PolicyCard(
                  policy: policy,
                  isDark: isDark,
                  onDelete: () => _confirmDelete(
                    title: 'Delete policy?',
                    description:
                        'Remove "${policy.policyName}" from your records? This cannot be undone.',
                    endpoint: ApiEndpoints.insurancePolicy(policy.id),
                  ),
                ),
              ),
          const SizedBox(height: 12),
          SectionHeader(
            title: 'Subscriptions',
            subtitle: '$_activeSubscriptionCount of $_subscriptionCount active',
            actionLabel: 'Add',
            actionIcon: Icons.add_rounded,
            onAction: _openAddSubscription,
          ),
          if (_subscriptions.isEmpty)
            _InlineEmpty(
              isDark: isDark,
              icon: Icons.autorenew_rounded,
              message:
                  'No subscriptions tracked. Add streaming, software or gym memberships to see your recurring spend.',
            )
          else
            for (final subscription in _subscriptions)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: _SubscriptionCard(
                  subscription: subscription,
                  isDark: isDark,
                  onDelete: () => _confirmDelete(
                    title: 'Delete subscription?',
                    description:
                        'Remove "${subscription.serviceName}" from your records? This cannot be undone.',
                    endpoint: ApiEndpoints.subscription(subscription.id),
                  ),
                ),
              ),
          if (_review != null) ...[
            const SizedBox(height: 12),
            _ReviewCard(review: _review!, isDark: isDark),
          ],
        ],
      ),
    );
  }

  Widget _buildMetricPills(bool isDark) {
    final nextRenewal = _nextRenewal;
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      children: [
        _MetricPill(
          icon: Icons.verified_user_rounded,
          label: '$_activePolicyCount active',
          isDark: isDark,
        ),
        _MetricPill(
          icon: Icons.autorenew_rounded,
          label: '$_monthlySubscriptionLabel / month',
          isDark: isDark,
        ),
        _MetricPill(
          icon: Icons.calendar_month_rounded,
          label: '$_annualSubscriptionLabel / year',
          isDark: isDark,
        ),
        if (nextRenewal != null)
          _MetricPill(
            icon: Icons.event_available_rounded,
            label: 'Renews ${DateFormatter.format(nextRenewal)}',
            isDark: isDark,
          ),
      ],
    );
  }

  Widget _buildSkeleton() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 40),
      children: const [
        SkeletonLoader(width: double.infinity, height: 132, borderRadius: 18),
        SizedBox(height: 16),
        SkeletonLoader(width: double.infinity, height: 40, borderRadius: 12),
        SizedBox(height: 24),
        SkeletonLoader(width: double.infinity, height: 90, borderRadius: 16),
        SizedBox(height: 12),
        SkeletonLoader(width: double.infinity, height: 90, borderRadius: 16),
      ],
    );
  }
}

class _MetricPill extends StatelessWidget {
  const _MetricPill({
    required this.icon,
    required this.label,
    required this.isDark,
  });

  final IconData icon;
  final String label;
  final bool isDark;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.surfaceSubtle(isDark),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border(isDark)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 15, color: AppColors.textSecondary(isDark)),
          const SizedBox(width: 7),
          Text(
            label,
            style: TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
              color: AppColors.textPrimary(isDark),
            ),
          ),
        ],
      ),
    );
  }
}

class _InlineEmpty extends StatelessWidget {
  const _InlineEmpty({
    required this.isDark,
    required this.icon,
    required this.message,
  });

  final bool isDark;
  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) {
    return FinancialCard(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 24),
      child: Column(
        children: [
          Icon(icon, size: 32, color: AppColors.textMuted(isDark)),
          const SizedBox(height: 12),
          Text(
            message,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 12.5,
              height: 1.45,
              color: AppColors.textSecondary(isDark),
            ),
          ),
        ],
      ),
    );
  }
}

class _PolicyCard extends StatelessWidget {
  const _PolicyCard({
    required this.policy,
    required this.isDark,
    required this.onDelete,
  });

  final InsurancePolicyModel policy;
  final bool isDark;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final cycleLabel = _titleCase(policy.premiumCycle);

    return FinancialCard(
      padding: const EdgeInsets.fromLTRB(16, 14, 8, 14),
      accent: AppColors.info,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        policy.policyName,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 14.5,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textPrimary(isDark),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    StatusBadge(
                      label: _titleCase(policy.policyType),
                      color: AppColors.info,
                    ),
                  ],
                ),
                if (policy.insurer != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    policy.insurer!,
                    style: TextStyle(
                      fontSize: 12,
                      color: AppColors.textSecondary(isDark),
                    ),
                  ),
                ],
                const SizedBox(height: 8),
                _KV(
                  label: 'Coverage',
                  value: CurrencyFormatter.format(policy.coverageAmount),
                  isDark: isDark,
                ),
                _KV(
                  label: 'Premium',
                  value:
                      '${CurrencyFormatter.format(policy.premium)} / ${cycleLabel.toLowerCase()}',
                  isDark: isDark,
                ),
                _KV(
                  label: 'Renews',
                  value: DateFormatter.format(policy.renewalDate),
                  isDark: isDark,
                ),
              ],
            ),
          ),
          PopupMenuButton<String>(
            tooltip: 'Policy options',
            padding: EdgeInsets.zero,
            onSelected: (value) {
              if (value == 'delete') onDelete();
            },
            itemBuilder: (_) => const [
              PopupMenuItem<String>(
                value: 'delete',
                child: Text('Delete policy'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _SubscriptionCard extends StatelessWidget {
  const _SubscriptionCard({
    required this.subscription,
    required this.isDark,
    required this.onDelete,
  });

  final SubscriptionModel subscription;
  final bool isDark;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final cycleLabel = _titleCase(subscription.billingCycle);

    return FinancialCard(
      padding: const EdgeInsets.fromLTRB(16, 14, 8, 14),
      accent: AppColors.purple,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        subscription.serviceName,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 14.5,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textPrimary(isDark),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      CurrencyFormatter.format(subscription.cost),
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary(isDark),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Text(
                      '$cycleLabel · next ${DateFormatter.format(subscription.nextBillingDate)}',
                      style: TextStyle(
                        fontSize: 12,
                        color: AppColors.textSecondary(isDark),
                      ),
                    ),
                  ],
                ),
                if (subscription.category != null) ...[
                  const SizedBox(height: 8),
                  StatusBadge(
                    label: subscription.category!,
                    color: AppColors.purple,
                  ),
                ],
              ],
            ),
          ),
          PopupMenuButton<String>(
            tooltip: 'Subscription options',
            padding: EdgeInsets.zero,
            onSelected: (value) {
              if (value == 'delete') onDelete();
            },
            itemBuilder: (_) => const [
              PopupMenuItem<String>(
                value: 'delete',
                child: Text('Delete subscription'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// The advisory output of `GET /ai/insurance-review`.
///
/// This endpoint is rules-based and deterministic (no model call), so the card
/// is safe to show whenever it loaded.
class _ReviewCard extends StatelessWidget {
  const _ReviewCard({required this.review, required this.isDark});

  final Map<String, dynamic> review;
  final bool isDark;

  @override
  Widget build(BuildContext context) {
    final recommendations = (review['recommendations'] as List?)
        ?.whereType<String>()
        .where((r) => r.trim().isNotEmpty)
        .toList() ??
        const <String>[];
    final disclaimer = review['disclaimer'] as String?;
    final lifeCover =
        review['formattedTotalLifeCover'] as String? ?? '';
    final healthCover =
        review['formattedTotalHealthCover'] as String? ?? '';

    return FinancialCard(
      padding: const EdgeInsets.all(18),
      accent: AppColors.primary,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.insights_rounded, size: 18, color: AppColors.primary),
              const SizedBox(width: 8),
              Text(
                'Coverage Review',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary(isDark),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              if (lifeCover.isNotEmpty)
                StatusBadge(label: 'Life $lifeCover', color: AppColors.info),
              if (healthCover.isNotEmpty)
                StatusBadge(label: 'Health $healthCover', color: AppColors.teal),
            ],
          ),
          if (recommendations.isEmpty) ...[
            const SizedBox(height: 12),
            Text(
              'Your coverage looks adequate against the current benchmark.',
              style: TextStyle(
                fontSize: 12.5,
                height: 1.45,
                color: AppColors.textSecondary(isDark),
              ),
            ),
          ] else ...[
            const SizedBox(height: 14),
            for (final recommendation in recommendations)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Container(
                        width: 5,
                        height: 5,
                        decoration: const BoxDecoration(
                          color: AppColors.warning,
                          shape: BoxShape.circle,
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        recommendation,
                        style: TextStyle(
                          fontSize: 12.5,
                          height: 1.45,
                          color: AppColors.textSecondary(isDark),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
          ],
          if (disclaimer != null && disclaimer.trim().isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              disclaimer,
              style: TextStyle(
                fontSize: 11.5,
                fontStyle: FontStyle.italic,
                height: 1.4,
                color: AppColors.textMuted(isDark),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _KV extends StatelessWidget {
  const _KV({
    required this.label,
    required this.value,
    required this.isDark,
  });

  final String label;
  final String value;
  final bool isDark;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 3),
      child: Row(
        children: [
          SizedBox(
            width: 82,
            child: Text(
              label,
              style: TextStyle(
                fontSize: 12,
                color: AppColors.textMuted(isDark),
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
                color: AppColors.textPrimary(isDark),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

String _titleCase(String value) {
  if (value.isEmpty) return value;
  final words = value.split('_');
  return words
      .map((w) => w.isEmpty ? w : w[0].toUpperCase() + w.substring(1).toLowerCase())
      .join(' ');
}
