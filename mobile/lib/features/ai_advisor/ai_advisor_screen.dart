import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/api/api_error.dart';
import '../../shared/widgets/pressable.dart';

/// Conversational AI advisor.
///
/// The backend already holds the real financial context (accounts, budgets,
/// goals, loans, investments) and can both answer questions and *perform*
/// actions through validated tools. This screen's job is therefore to be an
/// honest, useful client of that contract:
///
///  * it restores the server-persisted conversation so context survives app
///    restarts and is shared with the web client;
///  * it surfaces the tools the advisor actually ran (never a fabricated
///    "Analysing..." claim) and the live sources a reply was grounded in;
///  * it labels deterministic/fallback answers so a rule-engine reply is never
///    presented as a full LLM answer;
///  * it fails loudly with a retry instead of inventing an answer.
class AiAdvisorScreen extends StatefulWidget {
  const AiAdvisorScreen({super.key});

  @override
  State<AiAdvisorScreen> createState() => _AiAdvisorScreenState();
}

/// A single conversational turn.
class _Turn {
  _Turn({
    required this.role,
    required this.content,
    this.sources = const [],
    this.actions = const [],
    this.note,
    this.failed = false,
    this.requiresConfirmation = false,
  });

  /// `user` or `assistant`.
  final String role;
  final String content;
  final List<String> sources;
  final List<String> actions;
  final String? note;
  final bool failed;

  /// True when the advisor only *proposed* a change. The proposal is not
  /// applied and the mobile client cannot approve it.
  final bool requiresConfirmation;
}

const _greeting =
    'Namaste! I am your FinPro AI Financial Co-pilot. I can see your live '
    'accounts, budgets, goals, loans and investments — and I can act on them '
    'for you (for example, record an expense or contribute to a goal). '
    'What would you like to do today?';

const _suggestedPrompts = <String>[
  'How much did I spend this month?',
  'How can I save ₹5,000 more this month?',
  'Evaluate my emergency fund health',
  'Should I prepay my loan or invest in a SIP?',
];

/// Human labels for the backend tool registry (`aiTools.js`). Unknown tool
/// names fall back to a prettified snake_case rendering so a newly added tool
/// still reads sensibly instead of showing raw identifiers.
const _actionLabels = <String, String>{
  'create_transaction': 'Recorded a transaction',
  'update_transaction': 'Updated a transaction',
  'delete_transaction': 'Deleted a transaction',
  'transfer_between_accounts': 'Transferred between accounts',
  'create_budget': 'Created a budget',
  'update_budget': 'Updated a budget',
  'delete_budget': 'Deleted a budget',
  'create_goal': 'Created a goal',
  'update_goal': 'Updated a goal',
  'contribute_to_goal': 'Contributed to a goal',
  'delete_goal': 'Deleted a goal',
  'create_loan': 'Added a loan',
  'update_loan': 'Updated a loan',
  'record_loan_payment': 'Recorded a loan payment',
  'delete_loan': 'Deleted a loan',
  'add_investment': 'Added an investment',
  'update_investment': 'Updated an investment',
  'delete_investment': 'Deleted an investment',
  'create_account': 'Created an account',
  'update_account': 'Updated an account',
  'deposit_to_account': 'Deposited to an account',
  'delete_account': 'Deleted an account',
  'create_card': 'Added a card',
  'update_card': 'Updated a card',
  'pay_credit_card': 'Paid a credit card',
  'delete_card': 'Deleted a card',
  'create_task': 'Created a task',
  'update_task': 'Updated a task',
  'complete_task': 'Completed a task',
  'delete_task': 'Deleted a task',
  'create_subscription': 'Added a subscription',
  'update_subscription': 'Updated a subscription',
  'delete_subscription': 'Deleted a subscription',
  'create_insurance': 'Added insurance cover',
  'update_insurance': 'Updated insurance cover',
  'delete_insurance': 'Removed insurance cover',
  'create_reminder': 'Created a reminder',
  'update_reminder': 'Updated a reminder',
  'delete_reminder': 'Deleted a reminder',
  'create_category': 'Created a category',
  'update_category': 'Updated a category',
  'confirm_pending_sms': 'Confirmed a detected SMS expense',
  'reject_pending_sms': 'Dismissed a detected SMS expense',
  'update_profile': 'Updated your profile',
};

String _friendlyAction(String name) {
  final known = _actionLabels[name];
  if (known != null) return known;
  final words = name.split('_').where((w) => w.isNotEmpty).toList();
  if (words.isEmpty) return 'Completed an action';
  final head = words.first;
  final capitalized = head[0].toUpperCase() + head.substring(1);
  return <String>[capitalized, ...words.skip(1)].join(' ');
}

/// Honest, provider-aware framing of how a reply was produced.
String? _sourceNote(String? source) {
  if (source == null || source.trim().isEmpty) return null;
  final value = source.toLowerCase();
  if (value.contains('fallback')) {
    return 'Deterministic fallback — the AI provider was unavailable';
  }
  if (value.contains('gemini-tools') || value.contains('gemini')) {
    return 'Gemini-powered reasoning over your ledger';
  }
  if (value.contains('rule_based')) return 'Deterministic rules engine';
  if (value.contains('ai_action_engine')) {
    return 'Action engine — verified against your ledger';
  }
  return source;
}

List<TextSpan> _inlineSpans(String text, TextStyle base, bool isDark) {
  final spans = <TextSpan>[];
  final pattern = RegExp(r'(\*\*[^*]+\*\*|`[^`]+`)');
  var index = 0;
  for (final match in pattern.allMatches(text)) {
    if (match.start > index) {
      spans.add(TextSpan(text: text.substring(index, match.start), style: base));
    }
    final token = match.group(0)!;
    if (token.startsWith('**')) {
      spans.add(
        TextSpan(
          text: token.substring(2, token.length - 2),
          style: base.copyWith(fontWeight: FontWeight.w700),
        ),
      );
    } else {
      spans.add(
        TextSpan(
          text: token.substring(1, token.length - 1),
          style: base.copyWith(
            fontFamily: 'monospace',
            color: isDark ? AppColors.primaryLight : AppColors.primaryDark,
          ),
        ),
      );
    }
    index = match.end;
  }
  if (index < text.length) {
    spans.add(TextSpan(text: text.substring(index), style: base));
  }
  return spans;
}

/// Renders a small, safe subset of Markdown (bold, inline code, bullet lists
/// and headings) without pulling in an HTML renderer — so model output can
/// never inject markup into the widget tree.
Widget _richBody(String content, bool isDark, Color color) {
  final base = TextStyle(fontSize: 13.5, height: 1.5, color: color);

  // Fast path: plain prose (the common case) skips the span machinery entirely
  // and stays a plain `Text`, which also keeps screen readers and widget tests
  // working against the literal string.
  final hasMarkup = RegExp(
    r'[*`#•]|^\s*[-*]\s',
    multiLine: true,
  ).hasMatch(content);
  if (!hasMarkup) {
    return Text(content, style: base);
  }

  final blocks = <Widget>[];

  for (final raw in content.split('\n')) {
    final line = raw.trimRight();
    if (line.trim().isEmpty) {
      blocks.add(const SizedBox(height: 8));
      continue;
    }

    final bullet = RegExp(r'^\s*[-*•]\s+(.*)$').firstMatch(line);
    if (bullet != null) {
      blocks.add(
        Padding(
          padding: const EdgeInsets.only(bottom: 5),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.only(top: 6, right: 8),
                child: Container(
                  width: 5,
                  height: 5,
                  decoration: BoxDecoration(
                    color: isDark ? AppColors.primaryLight : AppColors.primary,
                    shape: BoxShape.circle,
                  ),
                ),
              ),
              Expanded(
                child: Text.rich(
                  TextSpan(
                    children: _inlineSpans(bullet.group(1)!, base, isDark),
                  ),
                ),
              ),
            ],
          ),
        ),
      );
      continue;
    }

    final heading = RegExp(r'^\s*#{1,6}\s+(.*)$').firstMatch(line);
    if (heading != null) {
      blocks.add(
        Padding(
          padding: const EdgeInsets.only(top: 2, bottom: 6),
          child: Text.rich(
            TextSpan(
              children: _inlineSpans(
                heading.group(1)!,
                base.copyWith(
                  fontWeight: FontWeight.w700,
                  fontSize: 14,
                  color: isDark
                      ? AppColors.primaryLight
                      : AppColors.primaryDark,
                ),
                isDark,
              ),
            ),
          ),
        ),
      );
      continue;
    }

    blocks.add(Text.rich(TextSpan(children: _inlineSpans(line, base, isDark))));
  }

  if (blocks.isEmpty) {
    blocks.add(Text.rich(TextSpan(text: content, style: base)));
  }
  return Column(crossAxisAlignment: CrossAxisAlignment.start, children: blocks);
}

class _AiAdvisorScreenState extends State<AiAdvisorScreen> {
  final _inputController = TextEditingController();
  final _scrollController = ScrollController();
  final List<_Turn> _turns = [];

  bool _loadingHistory = true;
  bool _isSending = false;
  bool _canSend = false;

  /// The most recent user message that failed, kept so the retry action can
  /// re-send exactly once without duplicating it in the transcript.
  String? _failedText;

  @override
  void initState() {
    super.initState();
    _inputController.addListener(_onInputChanged);
    _turns.add(_Turn(role: 'assistant', content: _greeting));
    _loadHistory();
  }

  void _onInputChanged() {
    final canSend = _inputController.text.trim().isNotEmpty;
    if (canSend != _canSend) {
      setState(() => _canSend = canSend);
    }
  }

  @override
  void dispose() {
    _inputController.removeListener(_onInputChanged);
    _inputController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _loadHistory() async {
    if (mounted) setState(() => _loadingHistory = true);
    try {
      final res = await apiClient.get(ApiEndpoints.aiHistory);
      final body = res.data;
      final data = body is Map ? body['data'] : null;
      final restored = <_Turn>[];
      if (data is List) {
        for (final raw in data) {
          if (raw is! Map) continue;
          final content = raw['content']?.toString() ?? '';
          if (content.trim().isEmpty) continue;
          restored.add(
            _Turn(
              role: raw['role'] == 'user' ? 'user' : 'assistant',
              content: content,
            ),
          );
        }
      }
      if (!mounted) return;
      setState(() {
        _loadingHistory = false;
        if (restored.isNotEmpty) {
          _turns
            ..clear()
            ..addAll(restored);
        }
      });
      _scrollToBottom();
    } catch (_) {
      // History is a convenience. A failure must not block a fresh
      // conversation, so the greeting simply stays in place.
      if (mounted) setState(() => _loadingHistory = false);
    }
  }

  Future<void> _sendMessage([String? presetText]) async {
    final text = (presetText ?? _inputController.text).trim();
    if (text.isEmpty || _isSending) return;

    _inputController.clear();
    setState(() {
      _turns.add(_Turn(role: 'user', content: text));
      _isSending = true;
      _failedText = null;
    });
    _scrollToBottom();

    try {
      final res = await apiClient.post(
        ApiEndpoints.aiChat,
        data: {'message': text},
        // The advisor runs several tool-calling rounds and may fall back
        // across models, so it can legitimately outlast the 45 s default that
        // protects the ordinary data endpoints.
        options: Options(
          sendTimeout: const Duration(seconds: 30),
          receiveTimeout: const Duration(seconds: 120),
        ),
      );

      final body = res.data;
      final data = body is Map ? body['data'] : null;
      final reply = data is Map ? data['response']?.toString() : null;

      if (body is Map && body['success'] == true && reply != null && reply.trim().isNotEmpty) {
        final pendingConfirmation =
            data is Map && data['pendingConfirmation'] == true;
        _addAssistant(
          _Turn(
            role: 'assistant',
            content: reply.trim(),
            sources: _readStrings(data is Map ? data['sources'] : null),
            // A proposal is not an executed action. Never show "Actions
            // performed" for something that was only prepared.
            actions: pendingConfirmation
                ? const []
                : _readActions(data is Map ? data['action'] : null),
            note: _sourceNote(data is Map ? data['source']?.toString() : null),
            requiresConfirmation: pendingConfirmation,
          ),
        );
      } else {
        _failWith(
          text,
          'The advisor returned an empty response. Your request was not '
              'actioned — please try again.',
        );
      }
    } catch (error) {
      _failWith(text, _chatFailureMessage(error));
    } finally {
      if (mounted) {
        setState(() => _isSending = false);
        _scrollToBottom();
      }
    }
  }

  /// Turns a transport failure into an honest, actionable sentence.
  ///
  /// A timeout is not proof that nothing happened: the server may still be
  /// running the tool calls after the socket closed, so the copy must not
  /// promise that no change was made.
  String _chatFailureMessage(Object error) {
    if (error is DioException) {
      final timedOut =
          error.type == DioExceptionType.receiveTimeout ||
          error.type == DioExceptionType.sendTimeout ||
          error.type == DioExceptionType.connectionTimeout;
      if (timedOut) {
        return 'The advisor is taking longer than expected. It may still be '
            'processing, so check your records before trying again.';
      }
    }
    return apiErrorMessage(error) ??
        'I could not reach the AI advisor. Check your connection and try again.';
  }

  List<String> _readStrings(dynamic raw) {
    if (raw is! List) return const [];
    return raw
        .map((e) => e?.toString() ?? '')
        .where((s) => s.trim().isNotEmpty)
        .toList();
  }

  List<String> _readActions(dynamic action) {
    if (action is! Map) return const [];
    // Only an action the server reports as executed may be shown as performed.
    if (action['executed'] != true) return const [];
    final names = <String>[];
    final steps = action['steps'];
    if (steps is List) {
      for (final step in steps) {
        if (step is Map && step['ok'] == true && step['pendingConfirmation'] != true) {
          final name = step['name']?.toString();
          if (name != null && name.trim().isNotEmpty) names.add(name);
        }
      }
    }
    if (names.isEmpty) {
      final type = action['type']?.toString();
      if (type != null && type.trim().isNotEmpty) names.add(type);
    }
    final seen = <String>{};
    return names.where(seen.add).toList();
  }

  void _addAssistant(_Turn turn) {
    if (!mounted) return;
    setState(() => _turns.add(turn));
  }

  void _failWith(String text, String message) {
    _failedText = text;
    _addAssistant(
      _Turn(role: 'assistant', content: message, failed: true),
    );
  }

  Future<void> _retry() async {
    final text = _failedText;
    if (text == null || _isSending) return;
    // Drop the failure turn so the transcript does not accumulate dead ends.
    setState(() {
      if (_turns.isNotEmpty && _turns.last.failed) _turns.removeLast();
    });
    await _sendMessage(text);
  }

  Future<void> _clearConversation() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Clear conversation?'),
        content: const Text(
          'This removes the saved advisor history for your account on every '
          'device. Your financial data is not affected.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Clear'),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    setState(() {
      _turns
        ..clear()
        ..add(_Turn(role: 'assistant', content: _greeting));
      _failedText = null;
    });

    try {
      await apiClient.delete(ApiEndpoints.aiHistory);
    } catch (_) {
      // The local transcript is already reset; a failed server clear only
      // means the history may reappear after a restart.
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 16,
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(7),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: AppColors.premiumGradient,
                ),
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Icon(
                Icons.auto_awesome_rounded,
                color: Colors.white,
                size: 17,
              ),
            ),
            const SizedBox(width: 11),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'AI Financial Co-pilot',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary(isDark),
                  ),
                ),
                Text(
                  'Grounded in your live ledger',
                  style: TextStyle(
                    fontSize: 11,
                    color: AppColors.textSecondary(isDark),
                  ),
                ),
              ],
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Clear conversation',
            onPressed: _turns.length > 1 ? _clearConversation : null,
            icon: const Icon(Icons.delete_outline_rounded),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: _loadingHistory && _turns.length <= 1
                ? const _HistorySkeleton()
                : ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 18,
                      vertical: 16,
                    ),
                    itemCount: _turns.length,
                    itemBuilder: (context, index) {
                      final turn = _turns[index];
                      final isLast = index == _turns.length - 1;
                      return _ChatBubble(
                        turn: turn,
                        isDark: isDark,
                        onRetry: isLast && turn.failed && _failedText != null
                            ? _retry
                            : null,
                      );
                    },
                  ),
          ),

          if (_isSending) _TypingIndicator(isDark: isDark),

          if (!_isSending && !_loadingHistory) _buildSuggestions(isDark),
          const SizedBox(height: 8),

          _buildComposer(isDark),
        ],
      ),
    );
  }

  Widget _buildSuggestions(bool isDark) {
    return SizedBox(
      height: 40,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 18),
        itemCount: _suggestedPrompts.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final prompt = _suggestedPrompts[index];
          return Center(
            child: Pressable(
              onTap: () => _sendMessage(prompt),
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 8,
                ),
                decoration: BoxDecoration(
                  color: AppColors.surfaceSubtle(isDark),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: AppColors.border(isDark)),
                ),
                child: Text(
                  prompt,
                  style: TextStyle(
                    fontSize: 12,
                    color: AppColors.textSecondary(isDark),
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildComposer(bool isDark) {
    return Container(
      padding: EdgeInsets.fromLTRB(
        16,
        10,
        12,
        10 + MediaQuery.of(context).padding.bottom,
      ),
      decoration: BoxDecoration(
        color: AppColors.surface(isDark),
        border: Border(top: BorderSide(color: AppColors.border(isDark))),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: Container(
              constraints: const BoxConstraints(maxHeight: 120),
              padding: const EdgeInsets.symmetric(horizontal: 14),
              decoration: BoxDecoration(
                color: AppColors.surfaceSubtle(isDark),
                borderRadius: BorderRadius.circular(22),
                border: Border.all(color: AppColors.border(isDark)),
              ),
              child: TextField(
                controller: _inputController,
                minLines: 1,
                maxLines: 4,
                textCapitalization: TextCapitalization.sentences,
                onSubmitted: (_) => _sendMessage(),
                decoration: const InputDecoration(
                  hintText: 'Ask about spending, budgets or loans...',
                  border: InputBorder.none,
                  enabledBorder: InputBorder.none,
                  focusedBorder: InputBorder.none,
                  isDense: true,
                  contentPadding: EdgeInsets.symmetric(vertical: 11),
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          _SendButton(enabled: _canSend && !_isSending, onTap: _sendMessage),
        ],
      ),
    );
  }
}

class _HistorySkeleton extends StatelessWidget {
  const _HistorySkeleton();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
      children: const [
        _SkeletonBubble(widthFactor: 0.7, alignEnd: false),
        _SkeletonBubble(widthFactor: 0.5, alignEnd: true),
        _SkeletonBubble(widthFactor: 0.8, alignEnd: false),
      ],
    );
  }
}

class _SkeletonBubble extends StatelessWidget {
  const _SkeletonBubble({required this.widthFactor, required this.alignEnd});

  final double widthFactor;
  final bool alignEnd;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final width = MediaQuery.of(context).size.width * widthFactor;
    return Align(
      alignment: alignEnd ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        width: width,
        height: 44,
        margin: const EdgeInsets.only(bottom: 14),
        decoration: BoxDecoration(
          color: AppColors.surfaceSubtle(isDark),
          borderRadius: BorderRadius.circular(14),
        ),
      ),
    );
  }
}

class _ChatBubble extends StatelessWidget {
  const _ChatBubble({
    required this.turn,
    required this.isDark,
    this.onRetry,
  });

  final _Turn turn;
  final bool isDark;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final isUser = turn.role == 'user';

    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Row(
        mainAxisAlignment: isUser
            ? MainAxisAlignment.end
            : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (!isUser) ...[
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: AppColors.premiumGradient,
                ),
                borderRadius: BorderRadius.circular(9),
              ),
              child: const Icon(
                Icons.auto_awesome_rounded,
                color: Colors.white,
                size: 16,
              ),
            ),
            const SizedBox(width: 10),
          ],
          Flexible(
            child: Column(
              crossAxisAlignment: isUser
                  ? CrossAxisAlignment.end
                  : CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    gradient: isUser
                        ? const LinearGradient(
                            colors: AppColors.primaryGradient,
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                          )
                        : null,
                    color: isUser ? null : AppColors.surface(isDark),
                    borderRadius: BorderRadius.only(
                      topLeft: const Radius.circular(16),
                      topRight: const Radius.circular(16),
                      bottomLeft: Radius.circular(isUser ? 16 : 4),
                      bottomRight: Radius.circular(isUser ? 4 : 16),
                    ),
                    border: isUser
                        ? null
                        : Border.all(
                            color: turn.failed
                                ? AppColors.expense.withValues(alpha: 0.5)
                                : AppColors.border(isDark),
                          ),
                  ),
                  child: isUser
                      ? Text(
                          turn.content,
                          style: const TextStyle(
                            fontSize: 13.5,
                            height: 1.5,
                            color: Colors.white,
                          ),
                        )
                      : _richBody(
                          turn.content,
                          isDark,
                          turn.failed
                              ? AppColors.expense
                              : AppColors.textPrimary(isDark),
                        ),
                ),

                if (!isUser && turn.requiresConfirmation)
                  _ConfirmationNotice(isDark: isDark),

                if (!isUser && turn.actions.isNotEmpty)
                  _ActionChips(actions: turn.actions, isDark: isDark),

                if (!isUser && turn.sources.isNotEmpty)
                  _SourceChips(sources: turn.sources, isDark: isDark),

                if (!isUser && turn.note != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      turn.note!,
                      style: TextStyle(
                        fontSize: 10.5,
                        fontStyle: FontStyle.italic,
                        color: AppColors.textMuted(isDark),
                      ),
                    ),
                  ),

                if (onRetry != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: _RetryButton(onTap: onRetry!),
                  ),
              ],
            ),
          ),
          if (isUser) const SizedBox(width: 10),
        ],
      ),
    );
  }
}

class _ConfirmationNotice extends StatelessWidget {
  const _ConfirmationNotice({required this.isDark});

  final bool isDark;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.pendingBadgeBg,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.warning.withValues(alpha: 0.45)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.shield_outlined,
            size: 14,
            color: AppColors.warning,
          ),
          const SizedBox(width: 7),
          Expanded(
            child: Text(
              'Not applied. This change still needs approval — open the FinPro '
              'web app to confirm or cancel it.',
              style: TextStyle(
                fontSize: 11,
                height: 1.4,
                color: AppColors.textSecondary(isDark),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ActionChips extends StatelessWidget {
  const _ActionChips({required this.actions, required this.isDark});

  final List<String> actions;
  final bool isDark;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Actions performed',
            style: TextStyle(
              fontSize: 10.5,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.3,
              color: AppColors.textMuted(isDark),
            ),
          ),
          const SizedBox(height: 5),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: actions
                .map(
                  (a) => Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 9,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.primary.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: AppColors.primary.withValues(alpha: 0.3),
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.check_circle_rounded,
                          size: 12,
                          color: AppColors.primaryLight,
                        ),
                        const SizedBox(width: 5),
                        Text(
                          _friendlyAction(a),
                          style: TextStyle(
                            fontSize: 11,
                            color: isDark
                                ? AppColors.primaryLight
                                : AppColors.primaryDark,
                          ),
                        ),
                      ],
                    ),
                  ),
                )
                .toList(),
          ),
        ],
      ),
    );
  }
}

class _SourceChips extends StatelessWidget {
  const _SourceChips({required this.sources, required this.isDark});

  final List<String> sources;
  final bool isDark;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Wrap(
        spacing: 6,
        runSpacing: 6,
        children: sources
            .map(
              (s) => Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 8,
                  vertical: 3,
                ),
                decoration: BoxDecoration(
                  color: AppColors.surfaceSubtle(isDark),
                  borderRadius: BorderRadius.circular(7),
                  border: Border.all(color: AppColors.border(isDark)),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.dataset_outlined,
                      size: 11,
                      color: AppColors.textMuted(isDark),
                    ),
                    const SizedBox(width: 4),
                    Text(
                      s,
                      style: TextStyle(
                        fontSize: 10,
                        color: AppColors.textSecondary(isDark),
                      ),
                    ),
                  ],
                ),
              ),
            )
            .toList(),
      ),
    );
  }
}

class _RetryButton extends StatelessWidget {
  const _RetryButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Pressable(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: AppColors.primary.withValues(alpha: 0.5)),
        ),
        child: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.refresh_rounded, size: 15, color: AppColors.primaryLight),
            SizedBox(width: 6),
            Text(
              'Try again',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.primaryLight,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TypingIndicator extends StatelessWidget {
  final bool isDark;

  const _TypingIndicator({required this.isDark});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 10),
      child: Row(
        children: [
          SizedBox(
            width: 14,
            height: 14,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              valueColor: const AlwaysStoppedAnimation(AppColors.primaryLight),
              backgroundColor: AppColors.surfaceSubtle(isDark),
            ),
          ),
          const SizedBox(width: 10),
          Text(
            'Analysing your financial context...',
            style: TextStyle(
              fontSize: 12,
              fontStyle: FontStyle.italic,
              color: AppColors.textSecondary(isDark),
            ),
          ),
        ],
      ),
    );
  }
}

class _SendButton extends StatelessWidget {
  final bool enabled;
  final VoidCallback onTap;

  const _SendButton({required this.enabled, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Pressable(
      enabled: enabled,
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        width: 46,
        height: 46,
        decoration: BoxDecoration(
          gradient: enabled
              ? const LinearGradient(colors: AppColors.primaryGradient)
              : null,
          color: enabled ? null : AppColors.surfaceSubtle(false),
          shape: BoxShape.circle,
        ),
        child: Icon(
          Icons.arrow_upward_rounded,
          color: enabled ? Colors.white : AppColors.textMuted(false),
          size: 22,
        ),
      ),
    );
  }
}
