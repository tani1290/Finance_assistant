import 'package:flutter/material.dart';

import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/api/api_error.dart';
import '../../core/models/calendar_event_model.dart';
import '../../core/utils/currency_formatter.dart';
import '../../core/utils/date_formatter.dart';
import '../../shared/widgets/error_state_view.dart';
import '../../shared/widgets/financial_card.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/skeleton_loader.dart';
import '../../shared/widgets/status_badge.dart';
import 'add_calendar_event_sheet.dart';

/// The mobile counterpart of the web `calendar.html` page.
///
/// Shows a month grid with a dot per event, then lists the month's events with
/// their amount and type. Rows derived from loans/subscriptions/goals are
/// read-only; only user-created events expose a delete action, because the
/// derived ones have no backing record and `DELETE /calendar/events/:id` 404s
/// for them.
class CalendarScreen extends StatefulWidget {
  const CalendarScreen({super.key});

  @override
  State<CalendarScreen> createState() => _CalendarScreenState();
}

class _CalendarScreenState extends State<CalendarScreen> {
  late int _year;
  late int _month;
  bool _isLoading = true;
  String? _errorMessage;
  List<CalendarEventModel> _events = [];

  /// Day-of-month selected in the grid, or null to list the whole month.
  int? _selectedDay;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _year = now.year;
    _month = now.month;
    _fetch();
  }

  Future<void> _fetch() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });
    try {
      final res = await apiClient.get(ApiEndpoints.calendarEvents(_month, _year));
      if (res.statusCode == 200 && res.data['success'] == true) {
        final data = res.data['data'];
        final dynamic raw = data is Map ? data['events'] : null;
        if (raw is! List) {
          throw const FormatException('Calendar response missing events');
        }
        final events = raw
            .whereType<Map>()
            .map((json) => CalendarEventModel.fromJson(Map<String, dynamic>.from(json)))
            .toList()
          ..sort((a, b) => a.date.compareTo(b.date));
        if (!mounted) return;
        setState(() {
          _events = events;
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
            'Your calendar could not be loaded. Check your connection and try again.';
        _isLoading = false;
      });
    }
  }

  void _changeMonth(int delta) {
    setState(() {
      _month += delta;
      if (_month > 12) {
        _month = 1;
        _year++;
      } else if (_month < 1) {
        _month = 12;
        _year--;
      }
      _selectedDay = null;
    });
    _fetch();
  }

  void _goToToday() {
    final now = DateTime.now();
    if (now.year == _year && now.month == _month) {
      setState(() => _selectedDay = now.day);
      return;
    }
    setState(() {
      _year = now.year;
      _month = now.month;
      _selectedDay = now.day;
    });
    _fetch();
  }

  Future<void> _openAddEvent() async {
    await AddCalendarEventSheet.show(
      context,
      // New events default to the month the user is looking at so the result is
      // visible immediately after saving.
      initialDate: _selectedDay != null
          ? DateTime(_year, _month, _selectedDay!)
          : DateTime.now(),
      onCreated: (message) {
        if (!mounted) return;
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(message)));
        _fetch();
      },
    );
  }

  Future<void> _deleteEvent(CalendarEventModel event) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete event?'),
        content: Text(
          'Remove "${event.title}" from your calendar? This cannot be undone.',
        ),
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
      await apiClient.delete(ApiEndpoints.calendarEvent(event.id));
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Event deleted.')));
      _fetch();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            apiErrorMessage(error) ??
                'The event could not be deleted. Check your connection.',
          ),
        ),
      );
    }
  }

  List<CalendarEventModel> get _visibleEvents {
    if (_selectedDay == null) return _events;
    return _events
        .where((e) => e.date.toLocal().day == _selectedDay && _isInViewedMonth(e))
        .toList();
  }

  bool _isInViewedMonth(CalendarEventModel event) {
    final local = event.date.toLocal();
    return local.year == _year && local.month == _month;
  }

  double get _monthAmount =>
      _events.fold(0.0, (sum, e) => sum + (e.amount ?? 0));

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Financial Calendar'),
        actions: [
          IconButton(
            tooltip: 'Today',
            icon: const Icon(Icons.today_rounded),
            onPressed: _goToToday,
          ),
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _fetch,
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _openAddEvent,
        icon: const Icon(Icons.add_rounded),
        label: const Text('Add'),
      ),
      body: Column(
        children: [
          _buildMonthHeader(isDark),
          Expanded(child: _buildContent(isDark)),
        ],
      ),
    );
  }

  Widget _buildMonthHeader(bool isDark) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 10),
      child: Row(
        children: [
          IconButton(
            tooltip: 'Previous month',
            icon: const Icon(Icons.chevron_left_rounded),
            onPressed: () => _changeMonth(-1),
          ),
          Expanded(
            child: Text(
              DateFormatter.formatMonthYear(DateTime(_year, _month)),
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary(isDark),
              ),
            ),
          ),
          IconButton(
            tooltip: 'Next month',
            icon: const Icon(Icons.chevron_right_rounded),
            onPressed: () => _changeMonth(1),
          ),
        ],
      ),
    );
  }

  Widget _buildContent(bool isDark) {
    if (_isLoading) return _buildSkeleton();

    if (_errorMessage != null) {
      return ErrorStateView(message: _errorMessage!, onRetry: _fetch);
    }

    final visible = _visibleEvents;

    return RefreshIndicator(
      onRefresh: _fetch,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 96),
        children: [
          _MonthGrid(
            year: _year,
            month: _month,
            events: _events.where(_isInViewedMonth).toList(),
            selectedDay: _selectedDay,
            onSelectDay: (day) {
              setState(() => _selectedDay = _selectedDay == day ? null : day);
            },
          ),
          const SizedBox(height: 16),
          _buildMonthSummary(isDark),
          const SizedBox(height: 22),
          _buildListHeader(isDark, visible.length),
          const SizedBox(height: 12),
          if (visible.isEmpty)
            _buildInlineEmpty(isDark)
          else
            ...visible.map(
              (event) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: _EventCard(
                  event: event,
                  isDark: isDark,
                  onDelete: () => _deleteEvent(event),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildMonthSummary(bool isDark) {
    final count = _events.where(_isInViewedMonth).length;
    return Row(
      children: [
        _SummaryPill(
          icon: Icons.event_available_rounded,
          label: '$count ${count == 1 ? 'event' : 'events'}',
          isDark: isDark,
        ),
        const SizedBox(width: 10),
        _SummaryPill(
          icon: Icons.currency_rupee_rounded,
          label: CurrencyFormatter.format(_monthAmount),
          isDark: isDark,
        ),
      ],
    );
  }

  Widget _buildListHeader(bool isDark, int count) {
    final title = _selectedDay == null
        ? 'Events in ${DateFormatter.formatMonthOnly(DateTime(_year, _month))}'
        : 'Events on ${DateFormatter.formatDayMonth(DateTime(_year, _month, _selectedDay!))}';

    return Row(
      children: [
        Expanded(
          child: Text(
            title,
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary(isDark),
            ),
          ),
        ),
        if (_selectedDay != null)
          TextButton(
            onPressed: () => setState(() => _selectedDay = null),
            child: const Text('Show all'),
          )
        else
          Text(
            '$count',
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: AppColors.textMuted(isDark),
            ),
          ),
      ],
    );
  }

  Widget _buildInlineEmpty(bool isDark) {
    return FinancialCard(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 26),
      child: Column(
        children: [
          Icon(
            Icons.event_busy_rounded,
            size: 34,
            color: AppColors.textMuted(isDark),
          ),
          const SizedBox(height: 12),
          Text(
            _selectedDay == null
                ? 'No events this month'
                : 'Nothing scheduled on this day',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: AppColors.textPrimary(isDark),
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'EMIs, subscription renewals and goal deadlines appear here automatically. Add a reminder for anything else.',
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

  Widget _buildSkeleton() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 96),
      children: [
        const SkeletonLoader(
          width: double.infinity,
          height: 250,
          borderRadius: 18,
        ),
        const SizedBox(height: 20),
        for (var i = 0; i < 3; i++) ...[
          const SkeletonLoader(
            width: double.infinity,
            height: 74,
            borderRadius: 16,
          ),
          const SizedBox(height: 12),
        ],
      ],
    );
  }
}

/// A fixed-height month grid. Rows are built explicitly with `Expanded` cells
/// so the layout cannot overflow on narrow screens.
class _MonthGrid extends StatelessWidget {
  const _MonthGrid({
    required this.year,
    required this.month,
    required this.events,
    required this.selectedDay,
    required this.onSelectDay,
  });

  final int year;
  final int month;
  final List<CalendarEventModel> events;
  final int? selectedDay;
  final ValueChanged<int> onSelectDay;

  static const _weekdayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  Map<int, List<CalendarEventModel>> get _byDay {
    final map = <int, List<CalendarEventModel>>{};
    for (final event in events) {
      final day = event.date.toLocal().day;
      map.putIfAbsent(day, () => []).add(event);
    }
    return map;
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final today = DateTime.now();
    final isCurrentMonth = today.year == year && today.month == month;

    // Dart weekday is Mon=1..Sun=7; the grid starts on Sunday, so remap.
    final leadingBlanks = DateTime(year, month, 1).weekday % 7;
    final daysInMonth = DateTime(year, month + 1, 0).day;
    final byDay = _byDay;

    final cells = <Widget>[];
    for (var i = 0; i < leadingBlanks; i++) {
      cells.add(const Expanded(child: SizedBox(height: 56)));
    }
    for (var day = 1; day <= daysInMonth; day++) {
      cells.add(
        Expanded(
          child: _DayCell(
            day: day,
            events: byDay[day] ?? const [],
            isToday: isCurrentMonth && today.day == day,
            isSelected: selectedDay == day,
            isDark: isDark,
            onTap: () => onSelectDay(day),
          ),
        ),
      );
    }
    while (cells.length % 7 != 0) {
      cells.add(const Expanded(child: SizedBox(height: 56)));
    }

    final rows = <Widget>[];
    for (var i = 0; i < cells.length; i += 7) {
      rows.add(Row(children: cells.sublist(i, i + 7)));
    }

    return FinancialCard(
      padding: const EdgeInsets.fromLTRB(10, 12, 10, 12),
      child: Column(
        children: [
          Row(
            children: [
              for (final label in _weekdayLabels)
                Expanded(
                  child: Text(
                    label,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 0.4,
                      color: AppColors.textMuted(isDark),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 6),
          ...rows,
        ],
      ),
    );
  }
}

class _DayCell extends StatelessWidget {
  const _DayCell({
    required this.day,
    required this.events,
    required this.isToday,
    required this.isSelected,
    required this.isDark,
    required this.onTap,
  });

  final int day;
  final List<CalendarEventModel> events;
  final bool isToday;
  final bool isSelected;
  final bool isDark;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final Color background;
    final Color borderColor;
    if (isSelected) {
      background = AppColors.primary.withValues(alpha: 0.18);
      borderColor = AppColors.primary.withValues(alpha: 0.55);
    } else if (isToday) {
      background = AppColors.primary.withValues(alpha: 0.08);
      borderColor = AppColors.primary.withValues(alpha: 0.28);
    } else {
      background = Colors.transparent;
      borderColor = Colors.transparent;
    }

    return Padding(
      padding: const EdgeInsets.all(2),
      child: Pressable(
        onTap: onTap,
        enableHaptics: false,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          height: 52,
          decoration: BoxDecoration(
            color: background,
            border: Border.all(color: borderColor),
            borderRadius: BorderRadius.circular(10),
          ),
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.start,
            children: [
              Text(
                '$day',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: isToday || isSelected
                      ? FontWeight.w700
                      : FontWeight.w500,
                  color: isToday || isSelected
                      ? AppColors.primaryLight
                      : AppColors.textSecondary(isDark),
                ),
              ),
              const SizedBox(height: 4),
              Wrap(
                spacing: 3,
                runSpacing: 3,
                alignment: WrapAlignment.center,
                children: [
                  for (final event in events.take(3))
                    Container(
                      width: 5,
                      height: 5,
                      decoration: BoxDecoration(
                        color: eventColor(event),
                        shape: BoxShape.circle,
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The accent used for an event marker.
///
/// Prefers the `color` the server assigns (`#RRGGBB`), falling back to the
/// per-type colour from the web legend when that field is absent or malformed.
Color eventColor(CalendarEventModel event) {
  final hex = event.color;
  if (hex != null && hex.length == 7 && hex.startsWith('#')) {
    final value = int.tryParse(hex.substring(1), radix: 16);
    if (value != null) return Color(0xFF000000 | value);
  }
  return eventTypeColor(event.type);
}

/// Colour for an event type, matching the legend used on the web calendar.
Color eventTypeColor(String type) {
  switch (type) {
    case 'EMI':
    case 'EMI_DUE':
    case 'LOAN_PAYMENT':
      return AppColors.expense;
    case 'SUBSCRIPTION':
    case 'INSURANCE_DUE':
      return AppColors.warning;
    case 'GOAL':
    case 'GOAL_MILESTONE':
    case 'SIP_DATE':
      return AppColors.income;
    default:
      return AppColors.indigo;
  }
}

/// Turns an API event-type code into a human label (`GOAL_MILESTONE` →
/// `Goal Milestone`). Short acronyms the app uses elsewhere (`EMI`, `SIP`,
/// `GST`) are kept upper-case rather than turned into `Emi`/`Sip`.
String eventTypeLabel(String type) {
  if (type.isEmpty) return 'Event';
  const acronyms = {'EMI', 'SIP', 'GST'};
  return type
      .split('_')
      .map((word) {
        if (word.isEmpty) return word;
        if (acronyms.contains(word.toUpperCase())) return word.toUpperCase();
        return word[0].toUpperCase() + word.substring(1).toLowerCase();
      })
      .join(' ');
}

class _EventCard extends StatelessWidget {
  const _EventCard({
    required this.event,
    required this.isDark,
    required this.onDelete,
  });

  final CalendarEventModel event;
  final bool isDark;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final dateLabel = DateFormatter.format(event.date);
    // Prefer the server's formatted string so the calendar renders currency
    // identically to the web page (which shows the same field).
    final amountLabel =
        event.formattedAmount ??
        (event.amount == null ? null : CurrencyFormatter.format(event.amount));

    return FinancialCard(
      padding: const EdgeInsets.fromLTRB(16, 14, 8, 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 10,
            height: 10,
            margin: const EdgeInsets.only(top: 5),
            decoration: BoxDecoration(
              color: eventColor(event),
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        event.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 14.5,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textPrimary(isDark),
                        ),
                      ),
                    ),
                    if (amountLabel != null) ...[
                      const SizedBox(width: 10),
                      Text(
                        amountLabel,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: AppColors.textPrimary(isDark),
                        ),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    Text(
                      dateLabel,
                      style: TextStyle(
                        fontSize: 12,
                        color: AppColors.textSecondary(isDark),
                      ),
                    ),
                    const SizedBox(width: 8),
                    StatusBadge(
                      label: eventTypeLabel(event.type),
                      color: eventColor(event),
                    ),
                  ],
                ),
                if (event.description.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(
                    event.description,
                    style: TextStyle(
                      fontSize: 12,
                      height: 1.4,
                      color: AppColors.textSecondary(isDark),
                    ),
                  ),
                ],
              ],
            ),
          ),
          // Derived rows have no backing record, so they offer no delete action.
          if (event.isEditable)
            PopupMenuButton<String>(
              tooltip: 'Event options',
              padding: EdgeInsets.zero,
              onSelected: (value) {
                if (value == 'delete') onDelete();
              },
              itemBuilder: (_) => const [
                PopupMenuItem<String>(
                  value: 'delete',
                  child: Text('Delete event'),
                ),
              ],
            )
          else
            const SizedBox(width: 8),
        ],
      ),
    );
  }
}

class _SummaryPill extends StatelessWidget {
  const _SummaryPill({
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
