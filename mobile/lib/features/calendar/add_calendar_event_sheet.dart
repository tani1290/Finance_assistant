import 'package:flutter/material.dart';

import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/api/api_error.dart';
import '../../core/utils/date_formatter.dart';
import '../../shared/widgets/gradient_button.dart';

/// Bottom sheet that records a custom calendar reminder through
/// `POST /calendar/events`.
///
/// Only the title and date are required; the backend stamps the rest. The date
/// is sent as a plain `YYYY-MM-DD` string because `calendar_events.event_date`
/// stores a calendar day, not an instant.
class AddCalendarEventSheet extends StatefulWidget {
  const AddCalendarEventSheet({
    super.key,
    required this.initialDate,
    required this.onCreated,
  });

  final DateTime initialDate;
  final ValueChanged<String> onCreated;

  static Future<void> show(
    BuildContext context, {
    required DateTime initialDate,
    required ValueChanged<String> onCreated,
  }) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => AddCalendarEventSheet(
        initialDate: initialDate,
        onCreated: onCreated,
      ),
    );
  }

  @override
  State<AddCalendarEventSheet> createState() => _AddCalendarEventSheetState();
}

class _AddCalendarEventSheetState extends State<AddCalendarEventSheet> {
  /// Mirrors the type list on the web calendar. These are free-form strings on
  /// the server, so additional values would also be accepted; the list just
  /// drives the colour coding and keeps web and mobile in step.
  static const _eventTypes = [
    'REMINDER',
    'EMI_DUE',
    'SIP_DATE',
    'INSURANCE_DUE',
    'SUBSCRIPTION',
    'GOAL_MILESTONE',
    'CUSTOM',
  ];

  final _titleController = TextEditingController();
  final _amountController = TextEditingController();
  final _descriptionController = TextEditingController();

  String _eventType = 'REMINDER';
  late DateTime _date = widget.initialDate;
  bool _isSaving = false;

  @override
  void dispose() {
    _titleController.dispose();
    _amountController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (picked != null && mounted) setState(() => _date = picked);
  }

  Future<void> _submit() async {
    final title = _titleController.text.trim();
    if (title.isEmpty) {
      _showError('Give the event a title.');
      return;
    }

    final rawAmount = _amountController.text.trim();
    double? amount;
    if (rawAmount.isNotEmpty) {
      amount = double.tryParse(rawAmount);
      if (amount == null || amount < 0) {
        _showError('Amount must be a number of zero or more, or left blank.');
        return;
      }
    }

    setState(() => _isSaving = true);
    try {
      await apiClient.post(
        ApiEndpoints.calendarEventsBase,
        data: {
          'title': title,
          'eventType': _eventType,
          'eventDate': DateFormatter.toDateOnly(_date),
          'amount': ?amount,
          if (_descriptionController.text.trim().isNotEmpty)
            'description': _descriptionController.text.trim(),
        },
      );
      if (!mounted) return;

      Navigator.pop(context);
      widget.onCreated('Event added.');
    } catch (error) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      _showError(
        apiErrorMessage(error) ??
            'Event could not be saved. Check your connection.',
      );
    }
  }

  void _showError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 24,
        right: 24,
        top: 24,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Add Calendar Event',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _titleController,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(
                labelText: 'Title',
                hintText: 'e.g. Pay credit card bill',
              ),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _eventType,
              decoration: const InputDecoration(labelText: 'Type'),
              items: [
                for (final type in _eventTypes)
                  DropdownMenuItem<String>(
                    value: type,
                    child: Text(_titleCase(type)),
                  ),
              ],
              onChanged: (value) {
                if (value != null) setState(() => _eventType = value);
              },
            ),
            const SizedBox(height: 12),
            InkWell(
              onTap: _pickDate,
              borderRadius: BorderRadius.circular(12),
              child: InputDecorator(
                decoration: const InputDecoration(
                  labelText: 'Date',
                  suffixIcon: Icon(Icons.calendar_today_rounded, size: 18),
                ),
                child: Text(DateFormatter.format(_date)),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _amountController,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: const InputDecoration(
                labelText: 'Amount (₹, optional)',
                hintText: 'e.g. 5000',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _descriptionController,
              textCapitalization: TextCapitalization.sentences,
              maxLines: 2,
              decoration: const InputDecoration(
                labelText: 'Notes (optional)',
              ),
            ),
            const SizedBox(height: 24),
            GradientButton(
              text: _isSaving ? 'Saving…' : 'Save Event',
              onPressed: _isSaving ? null : _submit,
            ),
          ],
        ),
      ),
    );
  }

  static String _titleCase(String value) {
    final words = value.split('_');
    return words
        .map(
          (w) => w.isEmpty ? w : w[0].toUpperCase() + w.substring(1).toLowerCase(),
        )
        .join(' ');
  }
}
