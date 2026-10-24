import 'package:intl/intl.dart';

class DateFormatter {
  static final DateFormat _standard = DateFormat('dd MMM yyyy');
  static final DateFormat _withTime = DateFormat('dd MMM, hh:mm a');
  static final DateFormat _monthYear = DateFormat('MMMM yyyy');
  static final DateFormat _dayMonth = DateFormat('d MMM');
  static final DateFormat _monthOnly = DateFormat('MMMM');

  static String format(DateTime? date) {
    if (date == null) return '';
    return _standard.format(date);
  }

  static String formatWithTime(DateTime? date) {
    if (date == null) return '';
    return _withTime.format(date);
  }

  static String formatMonthYear(DateTime? date) {
    if (date == null) return '';
    return _monthYear.format(date);
  }

  /// `d MMM`, for compact labels that sit next to a known year/month.
  static String formatDayMonth(DateTime? date) {
    if (date == null) return '';
    return _dayMonth.format(date);
  }

  /// `MMMM`, for headings where the year is already shown elsewhere.
  static String formatMonthOnly(DateTime? date) {
    if (date == null) return '';
    return _monthOnly.format(date);
  }

  /// The `YYYY-MM-DD` form the API accepts for date-only fields such as
  /// `insurance_policies.renewal_date`, `subscriptions.next_billing_date` and
  /// `calendar_events.event_date`.
  ///
  /// These columns store a calendar date, not an instant. Sending a full
  /// timestamp would let the server's timezone shift the stored day, so the
  /// plain date is sent — the same thing the web app's `<input type="date">`
  /// produces.
  static String toDateOnly(DateTime date) {
    final local = date.toLocal();
    final year = local.year.toString().padLeft(4, '0');
    final month = local.month.toString().padLeft(2, '0');
    final day = local.day.toString().padLeft(2, '0');
    return '$year-$month-$day';
  }

  static String relative(DateTime? date) {
    if (date == null) return '';
    final now = DateTime.now();
    final diff = now.difference(date);

    if (diff.inDays == 0) {
      if (diff.inHours == 0) {
        if (diff.inMinutes <= 1) return 'Just now';
        return '${diff.inMinutes}m ago';
      }
      return '${diff.inHours}h ago';
    } else if (diff.inDays == 1) {
      return 'Yesterday';
    } else if (diff.inDays < 7) {
      return '${diff.inDays}d ago';
    }
    return format(date);
  }
}
