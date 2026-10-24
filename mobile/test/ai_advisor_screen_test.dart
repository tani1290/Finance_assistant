import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:finpro_mobile/core/api/api_client.dart';
import 'package:finpro_mobile/features/ai_advisor/ai_advisor_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// A scripted stand-in for the AI endpoints. It answers `/ai/history`,
/// `/ai/chat` and the history DELETE exactly like the real controller
/// envelopes, so the screen's contract handling (roles, tools, sources,
/// honesty on failure) can be asserted without a network or an LLM.
class _AiAdapter implements HttpClientAdapter {
  List<Map<String, dynamic>> history = const [];
  Map<String, dynamic> chatBody = const {
    'success': true,
    'data': {'response': 'ok'},
  };
  int chatStatus = 200;
  DioException? chatError;

  int chatCalls = 0;
  int historyCalls = 0;
  bool deleteCalled = false;
  String? lastChatMessage;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final path = options.uri.path;

    if (path.endsWith('/ai/history')) {
      if (options.method == 'DELETE') {
        deleteCalled = true;
        return _json(200, {
          'success': true,
          'data': {'message': 'Chat history cleared.'},
        });
      }
      historyCalls++;
      return _json(200, {'success': true, 'data': history});
    }

    if (path.endsWith('/ai/chat')) {
      chatCalls++;
      final data = options.data;
      if (data is Map) lastChatMessage = data['message']?.toString();
      final failure = chatError;
      if (failure != null) throw failure;
      return _json(chatStatus, chatBody);
    }

    return _json(404, {
      'success': false,
      'error': {'code': 'ROUTE_NOT_FOUND', 'message': 'Not found.'},
    });
  }

  ResponseBody _json(int statusCode, Object body) {
    return ResponseBody.fromString(
      jsonEncode(body),
      statusCode,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

/// Bounded settle: the sending state renders a [CircularProgressIndicator],
/// whose endless animation makes `pumpAndSettle` time out, so the transcript is
/// advanced with explicit frames instead.
Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 60));
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _AiAdapter adapter;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
    adapter = _AiAdapter();
    apiClient.dio.httpClientAdapter = adapter;
  });

  testWidgets('restores the server-persisted conversation on open', (
    tester,
  ) async {
    adapter.history = [
      {'role': 'user', 'content': 'What did I spend on food?'},
      {'role': 'assistant', 'content': 'You spent ₹4,200 on food this month.'},
    ];

    await tester.pumpWidget(const MaterialApp(home: AiAdvisorScreen()));
    await _settle(tester);

    expect(adapter.historyCalls, 1);
    expect(find.text('What did I spend on food?'), findsOneWidget);
    expect(find.text('You spent ₹4,200 on food this month.'), findsOneWidget);
    // The static greeting is replaced by real history.
    expect(find.textContaining('Namaste'), findsNothing);
  });

  testWidgets('an empty history keeps the greeting', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: AiAdvisorScreen()));
    await _settle(tester);

    expect(find.textContaining('Namaste'), findsOneWidget);
  });

  testWidgets('surfaces the tools used and the grounding sources', (
    tester,
  ) async {
    adapter.chatBody = {
      'success': true,
      'data': {
        'response': 'Done — I recorded your ₹500 expense.',
        'source': 'gemini-tools',
        'sources': ['transactions', 'budgets'],
        'action': {
          'executed': true,
          'type': 'create_transaction',
          'steps': [
            {'name': 'create_transaction', 'ok': true},
          ],
        },
      },
    };

    await tester.pumpWidget(const MaterialApp(home: AiAdvisorScreen()));
    await _settle(tester);

    await tester.tap(find.text('How much did I spend this month?'));
    await _settle(tester);

    expect(adapter.chatCalls, 1);
    expect(find.text('Done — I recorded your ₹500 expense.'), findsOneWidget);
    expect(find.text('Actions performed'), findsOneWidget);
    expect(find.text('Recorded a transaction'), findsOneWidget);
    expect(find.text('transactions'), findsOneWidget);
    expect(find.text('budgets'), findsOneWidget);
    expect(find.textContaining('Gemini-powered reasoning'), findsOneWidget);
  });

  testWidgets('a rejected request shows the reason and retry recovers', (
    tester,
  ) async {
    adapter.chatStatus = 400;
    adapter.chatBody = {
      'success': false,
      'error': {'code': 'VALIDATION_ERROR', 'message': 'Message is required.'},
    };

    await tester.pumpWidget(const MaterialApp(home: AiAdvisorScreen()));
    await _settle(tester);

    await tester.tap(find.text('How much did I spend this month?'));
    await _settle(tester);

    expect(find.text('Message is required.'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
    // No fabricated answer is appended on failure.
    expect(find.textContaining('Done —'), findsNothing);

    adapter.chatStatus = 200;
    adapter.chatBody = const {
      'success': true,
      'data': {'response': 'Here is your spending summary.'},
    };

    await tester.tap(find.text('Try again'));
    await _settle(tester);

    expect(adapter.chatCalls, 2);
    expect(find.text('Here is your spending summary.'), findsOneWidget);
    expect(find.text('Try again'), findsNothing);
  });

  testWidgets('a timed-out request stays honest about unknown side effects', (
    tester,
  ) async {
    adapter.chatError = DioException(
      requestOptions: RequestOptions(path: '/ai/chat'),
      type: DioExceptionType.receiveTimeout,
    );

    await tester.pumpWidget(const MaterialApp(home: AiAdvisorScreen()));
    await _settle(tester);

    await tester.tap(find.text('How much did I spend this month?'));
    await _settle(tester);

    expect(find.textContaining('taking longer than expected'), findsOneWidget);
    // The server may still be running tool calls, so the screen must not
    // promise that nothing changed.
    expect(find.textContaining('nothing was changed'), findsNothing);
    expect(find.text('Try again'), findsOneWidget);

    adapter.chatError = null;
    adapter.chatBody = const {
      'success': true,
      'data': {'response': 'Recovered after retry.'},
    };

    await tester.tap(find.text('Try again'));
    await _settle(tester);

    expect(find.text('Recovered after retry.'), findsOneWidget);
    expect(find.textContaining('taking longer than expected'), findsNothing);
  });

  testWidgets('clearing the conversation resets the transcript and the server', (
    tester,
  ) async {
    adapter.history = [
      {'role': 'user', 'content': 'What did I spend on food?'},
      {'role': 'assistant', 'content': 'You spent ₹4,200 on food this month.'},
    ];

    await tester.pumpWidget(const MaterialApp(home: AiAdvisorScreen()));
    await _settle(tester);

    expect(find.text('What did I spend on food?'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.delete_outline_rounded));
    await _settle(tester);

    expect(find.text('Clear conversation?'), findsOneWidget);

    await tester.tap(find.text('Clear'));
    await _settle(tester);

    expect(adapter.deleteCalled, isTrue);
    expect(find.text('What did I spend on food?'), findsNothing);
    expect(find.textContaining('Namaste'), findsOneWidget);
  });

  testWidgets('a pending confirmation is never presented as applied', (
    tester,
  ) async {
    adapter.chatBody = {
      'success': true,
      'data': {
        'response':
            '### Confirmation required\n**Record a transaction**\n'
                'Nothing has been changed yet.',
        'source': 'gemini-tools',
        'sources': ['transactions'],
        'pendingConfirmation': true,
        'confirmation': {
          'token': 'a' * 64,
          'toolName': 'create_transaction',
          'description': 'Record a transaction',
          'ttlSeconds': 300,
        },
        'action': {
          'executed': false,
          'type': 'create_transaction',
          'requiresConfirmation': true,
          'steps': [
            {'name': 'create_transaction', 'ok': true, 'pendingConfirmation': true},
          ],
        },
      },
    };

    await tester.pumpWidget(const MaterialApp(home: AiAdvisorScreen()));
    await _settle(tester);

    await tester.tap(find.text('How much did I spend this month?'));
    await _settle(tester);

    expect(adapter.chatCalls, 1);
    expect(find.textContaining('Nothing has been changed yet'), findsOneWidget);
    // The proposal is not an executed action: no "Actions performed" chips.
    expect(find.text('Actions performed'), findsNothing);
    expect(find.text('Recorded a transaction'), findsNothing);
    // The user is told, in the app, that nothing was applied and that
    // approval happens on the web client.
    expect(find.textContaining('Not applied'), findsOneWidget);
    expect(find.textContaining('web app'), findsOneWidget);
  });

  testWidgets('a proposal without confirmation metadata is not shown as performed', (
    tester,
  ) async {
    adapter.chatBody = {
      'success': true,
      'data': {
        'response': 'I prepared that for you.',
        'action': {
          'executed': false,
          'type': 'create_transaction',
          'steps': [
            {'name': 'create_transaction', 'ok': true},
          ],
        },
      },
    };

    await tester.pumpWidget(const MaterialApp(home: AiAdvisorScreen()));
    await _settle(tester);

    await tester.tap(find.text('How much did I spend this month?'));
    await _settle(tester);

    expect(find.text('Actions performed'), findsNothing);
    expect(find.text('Recorded a transaction'), findsNothing);
  });
}
