/// Shared, strict JSON field parsing for the API models.
///
/// Previously each `fromJson` silently substituted `''`, `0.0` or `DateTime.now()`
/// when a required field was missing or unparseable. A server bug or a truncated
/// payload then rendered as a plausible-but-wrong account, amount or date.
/// These helpers reject such payloads instead.
///
/// Feature screens already wrap model construction in a `try`/`catch` and show
/// an error state, so a rejected record fails loudly rather than quietly.
class ModelParseException implements Exception {
  const ModelParseException(this.model, this.field);

  /// The model whose `fromJson` rejected the payload.
  final String model;

  /// The offending JSON field.
  final String field;

  @override
  String toString() =>
      'ModelParseException: $model.$field is missing or not a valid value';
}

/// Requires a non-empty string. Numeric ids are accepted and stringified.
String parseRequiredString(
  Map<String, dynamic> json,
  String field, {
  required String model,
}) {
  final value = json[field];
  if (value is String && value.trim().isNotEmpty) return value;
  if (value is num) return value.toString();
  throw ModelParseException(model, field);
}

/// Requires a finite number, accepting either a JSON number or a numeric string.
double parseRequiredDouble(
  Map<String, dynamic> json,
  String field, {
  required String model,
}) {
  return parseRequiredDoubleValue(json[field], field: field, model: model);
}

/// Requires a finite number from an already-resolved value.
///
/// Used where a field has more than one possible source key — for example the
/// list endpoints flatten relation names (`outstandingBalance`, `averageBuyPrice`)
/// while a create/detail payload may use the short form.
double parseRequiredDoubleValue(
  Object? value, {
  required String field,
  required String model,
}) {
  if (value is num) {
    final parsed = value.toDouble();
    if (parsed.isFinite) return parsed;
  } else if (value is String) {
    final parsed = double.tryParse(value.trim());
    if (parsed != null && parsed.isFinite) return parsed;
  }
  throw ModelParseException(model, field);
}

/// Parses an optional finite number, accepting a JSON number or a numeric
/// string. Returns `null` when the value is absent, `null`, or unparseable.
///
/// Unlike [parseRequiredDoubleValue] this never throws: it is for genuinely
/// optional fields (a calendar event's amount, for example), where absence is a
/// valid state rather than a malformed record.
double? parseOptionalDouble(Object? value) {
  if (value is num) {
    final parsed = value.toDouble();
    return parsed.isFinite ? parsed : null;
  }
  if (value is String) {
    final parsed = double.tryParse(value.trim());
    if (parsed != null && parsed.isFinite) return parsed;
  }
  return null;
}

/// Requires an integer, accepting a JSON number or a numeric string.
int parseRequiredInt(
  Map<String, dynamic> json,
  String field, {
  required String model,
}) {
  final value = json[field];
  if (value is int) return value;
  if (value is num) {
    if (value.isFinite) return value.toInt();
  } else if (value is String) {
    final trimmed = value.trim();
    final parsed = int.tryParse(trimmed) ?? double.tryParse(trimmed)?.toInt();
    if (parsed != null) return parsed;
  }
  throw ModelParseException(model, field);
}

/// Requires an ISO-8601 timestamp that [DateTime.parse] accepts.
DateTime parseRequiredDate(
  Map<String, dynamic> json,
  String field, {
  required String model,
}) {
  final value = json[field];
  if (value is String) {
    final parsed = DateTime.tryParse(value.trim());
    if (parsed != null) return parsed;
  }
  throw ModelParseException(model, field);
}
