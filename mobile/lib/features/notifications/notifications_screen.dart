import 'package:flutter/material.dart';
import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../shared/widgets/empty_state_view.dart';
import '../../shared/widgets/financial_card.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _notifications = [];

  @override
  void initState() {
    super.initState();
    _fetchNotifications();
  }

  Future<void> _fetchNotifications() async {
    setState(() => _isLoading = true);
    try {
      final res = await apiClient.get(ApiEndpoints.notifications);
      if (res.statusCode == 200 && res.data['success'] == true) {
        final list = (res.data['data'] as List)
            .map((item) => Map<String, dynamic>.from(item as Map))
            .toList();
        setState(() {
          _notifications = list;
          _isLoading = false;
        });
      }
    } catch (_) {
      // Sample fallback notifications
      setState(() {
        _notifications = [
          {
            'title': 'Salary Credit Detected',
            'message': 'Your account ending in 1234 was credited with monthly salary. ₹15,000 auto-transferred to active SIPs.',
            'type': 'CREDIT',
            'time': 'Today, 10:15 AM',
          },
          {
            'title': 'Budget Alert: Dining (69%)',
            'message': 'You have spent ₹38,200 of your ₹55,000 monthly limit. Safe to spend ₹16,800 remaining.',
            'type': 'WARNING',
            'time': 'Yesterday',
          },
          {
            'title': 'EMI Payment Due in 3 Days',
            'message': 'Home loan EMI of ₹28,500 due on 15th October via auto-debit.',
            'type': 'REMINDER',
            'time': '2 days ago',
          },
        ];
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _fetchNotifications,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _notifications.isEmpty
              ? EmptyStateView(
                  icon: Icons.notifications_none_rounded,
                  title: 'No New Notifications',
                  description: 'All your alerts, budget warnings, and payment reminders are up to date.',
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(18),
                  itemCount: _notifications.length,
                  itemBuilder: (context, index) {
                    final item = _notifications[index];
                    final title = item['title'] ?? item['subject'] ?? 'Notice';
                    final message = item['message'] ?? item['body'] ?? '';

                    return Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: FinancialCard(
                        padding: const EdgeInsets.all(16),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Container(
                              padding: const EdgeInsets.all(8),
                              decoration: BoxDecoration(
                                color: AppColors.primary.withValues(alpha: 0.12),
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(Icons.notifications_active_rounded, color: AppColors.primaryLight, size: 18),
                            ),
                            const SizedBox(width: 14),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                                  const SizedBox(height: 4),
                                  Text(
                                    message,
                                    style: const TextStyle(fontSize: 12.5, color: AppColors.darkTextSecondary, height: 1.4),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
    );
  }
}
