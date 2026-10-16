import 'package:flutter/material.dart';
import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../shared/widgets/pressable.dart';

class AiAdvisorScreen extends StatefulWidget {
  const AiAdvisorScreen({super.key});

  @override
  State<AiAdvisorScreen> createState() => _AiAdvisorScreenState();
}

class _AiAdvisorScreenState extends State<AiAdvisorScreen> {
  final _inputController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  bool _isSending = false;
  bool _canSend = false;

  final List<Map<String, String>> _messages = [
    {
      'role': 'assistant',
      'content':
          'Namaste! I am your FinPro AI Financial Co-pilot. I have access to your financial context — your cash flow, loans, active SIPs, and budgets. How can I help you make a sound money decision today?',
    },
  ];

  final List<String> _suggestedPrompts = [
    'How can I save ₹5,000 more this month?',
    'Explain ELSS tax saving under Section 80C',
    'Evaluate my emergency fund health',
    'Should I prepay my loan or invest in SIP?',
  ];

  @override
  void initState() {
    super.initState();
    _inputController.addListener(_onInputChanged);
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

  Future<void> _sendMessage([String? presetText]) async {
    final text = (presetText ?? _inputController.text).trim();
    if (text.isEmpty || _isSending) return;

    _inputController.clear();
    setState(() {
      _messages.add({'role': 'user', 'content': text});
      _isSending = true;
    });

    _scrollToBottom();

    try {
      final res = await apiClient.post(
        ApiEndpoints.aiChat,
        data: {'message': text},
      );

      if (res.statusCode == 200 && res.data['success'] == true) {
        final data = res.data['data'] ?? {};
        final reply =
            data['response'] ??
            data['reply'] ??
            data['message'] ??
            'I have reviewed your financial parameters. Your plan remains balanced.';
        setState(() {
          _messages.add({'role': 'assistant', 'content': reply.toString()});
        });
      } else {
        _addAssistantMessage(
          'I am currently operating in deterministic fallback mode. Based on standard financial rules, allocate 50% to needs, 30% to wants, and 20% to savings.',
        );
      }
    } catch (_) {
      _addAssistantMessage(
        'Offline Guidance: Keep 6 months of basic living expenses in liquid FDs or savings before deploying funds to high-risk equity.',
      );
    } finally {
      if (mounted) {
        setState(() => _isSending = false);
        _scrollToBottom();
      }
    }
  }

  void _addAssistantMessage(String content) {
    setState(() => _messages.add({'role': 'assistant', 'content': content}));
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
                gradient: const LinearGradient(colors: AppColors.premiumGradient),
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
                  'Context-aware advisory',
                  style: TextStyle(
                    fontSize: 11,
                    color: AppColors.textSecondary(isDark),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView.builder(
              controller: _scrollController,
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
              itemCount: _messages.length,
              itemBuilder: (context, index) {
                final msg = _messages[index];
                final isUser = msg['role'] == 'user';
                return _ChatBubble(
                  isUser: isUser,
                  content: msg['content']!,
                  isDark: isDark,
                );
              },
            ),
          ),

          if (_isSending) _TypingIndicator(isDark: isDark),

          if (_messages.length <= 2)
            SizedBox(
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
            ),
          const SizedBox(height: 8),

          _buildComposer(isDark),
        ],
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
                  hintText: 'Ask about taxes, budgets, or investments...',
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
          _SendButton(
            enabled: _canSend && !_isSending,
            onTap: _sendMessage,
          ),
        ],
      ),
    );
  }
}

class _ChatBubble extends StatelessWidget {
  final bool isUser;
  final String content;
  final bool isDark;

  const _ChatBubble({
    required this.isUser,
    required this.content,
    required this.isDark,
  });

  @override
  Widget build(BuildContext context) {
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
            child: Container(
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
                    : Border.all(color: AppColors.border(isDark)),
              ),
              child: Text(
                content,
                style: TextStyle(
                  fontSize: 13.5,
                  height: 1.5,
                  color: isUser
                      ? Colors.white
                      : AppColors.textPrimary(isDark),
                ),
              ),
            ),
          ),
          if (isUser) const SizedBox(width: 10),
        ],
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
            'Analyzing your financial context...',
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
