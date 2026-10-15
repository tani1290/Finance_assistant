import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// A tactile press wrapper.
///
/// Wraps any widget and gives it a subtle spring "press-in" animation plus a
/// light haptic tick. Using this for cards, list rows and pills is one of the
/// cheapest ways to make a Flutter app feel like a paid, native product.
class Pressable extends StatefulWidget {
  final Widget child;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final double scale;
  final BorderRadius? borderRadius;
  final bool enableHaptics;
  final bool enabled;

  const Pressable({
    super.key,
    required this.child,
    this.onTap,
    this.onLongPress,
    this.scale = 0.97,
    this.borderRadius,
    this.enableHaptics = true,
    this.enabled = true,
  });

  @override
  State<Pressable> createState() => _PressableState();
}

class _PressableState extends State<Pressable> {
  bool _pressed = false;

  bool get _interactive =>
      widget.enabled && (widget.onTap != null || widget.onLongPress != null);

  void _setPressed(bool value) {
    if (!_interactive || _pressed == value) return;
    setState(() => _pressed = value);
  }

  void _handleTap() {
    if (!_interactive) return;
    if (widget.enableHaptics) HapticFeedback.lightImpact();
    widget.onTap?.call();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: (_) => _setPressed(true),
      onTapUp: (_) => _setPressed(false),
      onTapCancel: () => _setPressed(false),
      onTap: _handleTap,
      onLongPress: widget.onLongPress == null
          ? null
          : () {
              if (!_interactive) return;
              if (widget.enableHaptics) HapticFeedback.mediumImpact();
              widget.onLongPress?.call();
            },
      child: AnimatedScale(
        scale: _pressed ? widget.scale : 1.0,
        duration: const Duration(milliseconds: 110),
        curve: Curves.easeOut,
        child: widget.child,
      ),
    );
  }
}
