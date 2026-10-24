import 'model_parse.dart';

/// A single entry on the financial calendar.
///
/// `GET /calendar/events` returns two kinds of row in one list:
///
/// * rows the user created (persisted in `calendar_events`), and
/// * rows the backend derives on the fly from active loans, subscriptions and
///   goals, tagged with a suffixed id (`<id>-emi`, `<id>-sub`, `<id>-goal`).
///
/// Only the first kind can be edited or deleted, which [isDerived] exposes so
/// the UI never offers a mutation the API would reject.
class CalendarEventModel {
  final String id;
  final String title;
  final String description;
  final String type;
  final DateTime date;

  /// Null when the event carries no money value (a plain reminder).
  final double? amount;

  /// Pre-formatted amount from the server, when present. Preferred for display
  /// so the calendar matches the web app's currency formatting exactly.
  final String? formattedAmount;

  /// Optional accent colour (`#RRGGBB`) the server supplies for custom events.
  final String? color;

  CalendarEventModel({
    required this.id,
    required this.title,
    required this.description,
    required this.type,
    required this.date,
    this.amount,
    this.formattedAmount,
    this.color,
  });

  /// True for events synthesised from a loan, subscription or goal. These have
  /// no backing row, so `PATCH`/`DELETE /calendar/events/:id` will 404.
  bool get isDerived =>
      id.endsWith('-emi') || id.endsWith('-sub') || id.endsWith('-goal');

  /// True only for user-created events, which are the ones the API can mutate.
  bool get isEditable => !isDerived;

  factory CalendarEventModel.fromJson(Map<String, dynamic> json) {
    const model = 'CalendarEventModel';

    final rawType = json['type'];
    final type = rawType is String && rawType.trim().isNotEmpty
        ? rawType.trim()
        : 'CUSTOM';

    return CalendarEventModel(
      id: parseRequiredString(json, 'id', model: model),
      title: parseRequiredString(json, 'title', model: model),
      description: (json['description'] as String?) ?? '',
      type: type,
      date: parseRequiredDate(json, 'date', model: model),
      amount: parseOptionalDouble(json['amount']),
      formattedAmount: json['formattedAmount'] as String?,
      color: json['color'] as String?,
    );
  }
}
