import 'package:flutter/material.dart';
import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/api/api_error.dart';
import '../../shared/widgets/empty_state_view.dart';
import '../../shared/widgets/error_state_view.dart';
import '../../shared/widgets/financial_card.dart';
import '../../shared/widgets/skeleton_loader.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  bool _isLoading = true;
  bool _hasLoaded = false;
  String? _errorMessage;
  List<Map<String, dynamic>> _notifications = [];

  @override
  void initState() {
    super.initState();
    _fetchNotifications();
  }

  Future<void> _fetchNotifications() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });
    try {
      final res = await apiClient.get(ApiEndpoints.notifications);
      if (res.statusCode == 200 && res.data['success'] == true) {
        final data = res.data['data'];
        if (data is! List) {
          throw const FormatException('Notifications response is not a list');
        }
        final list = data
            .whereType<Map>()
            .map((item) => Map<String, dynamic>.from(item))
            .toList();
        if (!mounted) return;
        setState(() {
          _notifications = list;
          _hasLoaded = true;
          _isLoading = false;
        });
      } else {
        if (!mounted) return;
        setState(() {
          _errorMessage = 'The server returned an unexpected response.';
          _isLoading = false;
        });
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _errorMessage =
            'Notifications could not be loaded. Check your connection and try again.';
        _isLoading = false;
      });
    }
  }

  /// Marks every notification read, then refreshes so the unread styling
  /// comes from the server rather than being assumed locally.
  Future<void> _markAllRead() async {
    try {
      await apiClient.post(ApiEndpoints.notificationsReadAll);
      if (!mounted) return;
      _fetchNotifications();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            apiErrorMessage(error) ??
                'Notifications could not be updated. Check your connection.',
          ),
        ),
      );
    }
  }

  Future<void> _markRead(Map<String, dynamic> item) async {
    if (item['isRead'] == true) return;
    final id = item['id']?.toString();
    if (id == null || id.isEmpty) return;
    try {
      await apiClient.patch(ApiEndpoints.notificationRead(id));
      if (!mounted) return;
      _fetchNotifications();
    } catch (_) {
      // A failed read receipt is non-destructive; the next refresh restores
      // the authoritative unread state, so no error banner is needed.
    }
  }

  /// Deleting a notification is permanent, so it asks for confirmation first.
  Future<void> _deleteNotification(Map<String, dynamic> item) async {
    final id = item['id']?.toString();
    if (id == null || id.isEmpty) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete notification?'),
        content: const Text('This notification will be removed permanently.'),
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
      await apiClient.delete(ApiEndpoints.notification(id));
      if (!mounted) return;
      _fetchNotifications();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            apiErrorMessage(error) ??
                'Notification could not be deleted. Check your connection.',
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final hasUnread = _notifications.any((item) => item['isRead'] != true);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          if (hasUnread)
            IconButton(
              tooltip: 'Mark all as read',
              icon: const Icon(Icons.done_all_rounded),
              onPressed: _markAllRead,
            ),
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _fetchNotifications,
          ),
        ],
      ),
      body: _isLoading && !_hasLoaded
          ? _buildSkeleton()
          : _errorMessage != null
          ? ErrorStateView(
              message: _errorMessage!,
              onRetry: _fetchNotifications,
            )
          : _notifications.isEmpty
          ? const EmptyStateView(
              icon: Icons.notifications_none_rounded,
              title: 'No New Notifications',
              description:
                  'All your alerts, budget warnings, and payment reminders are up to date.',
            )
          : RefreshIndicator(
              onRefresh: _fetchNotifications,
              child: ListView.builder(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(18, 16, 18, 32),
                itemCount: _notifications.length,
                itemBuilder: (context, index) => Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: _NotificationTile(
                    item: _notifications[index],
                    isDark: isDark,
                    onTap: () => _markRead(_notifications[index]),
                    onDelete: () => _deleteNotification(_notifications[index]),
                  ),
                ),
              ),
            ),
    );
  }

  Widget _buildSkeleton() {
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 32),
      itemCount: 4,
      itemBuilder: (context, index) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: const FinancialCard(
          padding: EdgeInsets.all(16),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SkeletonLoader(width: 34, height: 34, borderRadius: 17),
              SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SkeletonLoader(width: 180, height: 14),
                    SizedBox(height: 8),
                    SkeletonLoader(width: double.infinity, height: 11),
                    SizedBox(height: 6),
                    SkeletonLoader(width: 220, height: 11),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  final Map<String, dynamic> item;
  final bool isDark;
  final VoidCallback onTap;
  final VoidCallback onDelete;

  const _NotificationTile({
    required this.item,
    required this.isDark,
    required this.onTap,
    required this.onDelete,
  });

  ({IconData icon, Color color}) get _style {
    switch ((item['type'] ?? '').toString().toUpperCase()) {
      case 'CREDIT':
      case 'INCOME':
        return (icon: Icons.south_west_rounded, color: AppColors.income);
      case 'WARNING':
      case 'ALERT':
        return (icon: Icons.warning_amber_rounded, color: AppColors.warning);
      case 'REMINDER':
        return (icon: Icons.alarm_rounded, color: AppColors.info);
      default:
        return (
          icon: Icons.notifications_active_rounded,
          color: AppColors.primaryLight,
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final style = _style;
    final title = item['title'] ?? item['subject'] ?? 'Notice';
    final message = item['message'] ?? item['body'] ?? '';
    final time = item['time'] ?? item['createdAt'];
    final isUnread = item['isRead'] != true;

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      child: FinancialCard(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: style.color.withValues(alpha: 0.14),
                shape: BoxShape.circle,
              ),
              child: Icon(style.icon, color: style.color, size: 18),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      if (isUnread) ...[
                        Container(
                          width: 7,
                          height: 7,
                          decoration: const BoxDecoration(
                            color: AppColors.primaryLight,
                            shape: BoxShape.circle,
                          ),
                        ),
                        const SizedBox(width: 6),
                      ],
                      Expanded(
                        child: Text(
                          title.toString(),
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 14,
                            color: AppColors.textPrimary(isDark),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    message.toString(),
                    style: TextStyle(
                      fontSize: 12.5,
                      color: AppColors.textSecondary(isDark),
                      height: 1.4,
                    ),
                  ),
                  if (time != null) ...[
                    const SizedBox(height: 8),
                    Text(
                      _formatTimestamp(time),
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textMuted(isDark),
                      ),
                    ),
                  ],
                ],
              ),
            ),
            PopupMenuButton<String>(
              tooltip: 'Notification options',
              padding: EdgeInsets.zero,
              onSelected: (value) {
                if (value == 'delete') onDelete();
              },
              itemBuilder: (_) => const [
                PopupMenuItem<String>(
                  value: 'delete',
                  child: Text('Delete notification'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /// The API returns ISO timestamps for `createdAt`; render them as a compact
  /// local date instead of showing the raw wire format.
  static String _formatTimestamp(Object value) {
    final parsed = DateTime.tryParse(value.toString());
    if (parsed == null) return value.toString();
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    final local = parsed.toLocal();
    final hour = local.hour % 12 == 0 ? 12 : local.hour % 12;
    final minute = local.minute.toString().padLeft(2, '0');
    final suffix = local.hour < 12 ? 'AM' : 'PM';
    return '${local.day} ${months[local.month - 1]} ${local.year}, '
        '$hour:$minute $suffix';
  }
}
