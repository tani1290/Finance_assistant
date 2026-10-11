import 'package:intl/intl.dart';

class DateFormatter {
  static final DateFormat _standard = DateFormat('dd MMM yyyy');
  static final DateFormat _withTime = DateFormat('dd MMM, hh:mm a');
  static final DateFormat _monthYear = DateFormat('MMMM yyyy');

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
