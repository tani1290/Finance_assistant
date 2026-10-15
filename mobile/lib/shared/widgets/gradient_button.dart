import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../app/theme/app_colors.dart';

/// The primary call-to-action control.
///
/// Despite the name it is a full-width, full-gradient button with spring press
/// feedback and a proper disabled/loading treatment. The API is intentionally
/// stable (`text`, `onPressed`, `isLoading`, `icon`, `height`, `isSecondary`)
/// so existing call-sites keep working.
class GradientButton extends StatefulWidget {
  final String text;
  final VoidCallback? onPressed;
  final bool isLoading;
  final IconData? icon;
  final double height;
  final bool isSecondary;

  /// Optional custom gradient (defaults to the brand gradient).
  final List<Color>? gradientColors;

  const GradientButton({
    super.key,
    required this.text,
    this.onPressed,
    this.isLoading = false,
    this.icon,
    this.height = 52,
    this.isSecondary = false,
    this.gradientColors,
  });

  @override
  State<GradientButton> createState() => _GradientButtonState();
}

class _GradientButtonState extends State<GradientButton> {
  bool _pressed = false;

  bool get _disabled => widget.onPressed == null || widget.isLoading;

  void _onTapDown(TapDownDetails _) {
    if (_disabled) return;
    setState(() => _pressed = true);
  }

  void _onTapUp(TapUpDetails _) {
    if (_pressed) setState(() => _pressed = false);
  }

  void _onTapCancel() {
    if (_pressed) setState(() => _pressed = false);
  }

  void _handleTap() {
    if (_disabled) return;
    HapticFeedback.lightImpact();
    widget.onPressed?.call();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final colors = widget.gradientColors ?? AppColors.primaryGradient;

    final content = widget.isLoading
        ? const SizedBox(
            height: 20,
            width: 20,
            child: CircularProgressIndicator(
              strokeWidth: 2.2,
              valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
            ),
          )
        : Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (widget.icon != null) ...[
                Icon(widget.icon, size: 19),
                const SizedBox(width: 8),
              ],
              Text(
                widget.text,
                style: const TextStyle(
                  fontSize: 15.5,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.1,
                  color: Colors.white,
                ),
              ),
            ],
          );

    // ── Secondary (outlined) variant ──────────────────────────────
    if (widget.isSecondary) {
      return SizedBox(
        height: widget.height,
        width: double.infinity,
        child: OutlinedButton(
          onPressed: _disabled ? null : widget.onPressed,
          style: OutlinedButton.styleFrom(
            side: BorderSide(
              color: isDark ? AppColors.darkBorder : AppColors.lightBorder,
            ),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
            ),
          ),
          child: widget.isLoading
              ? const SizedBox(
                  height: 20,
                  width: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    if (widget.icon != null) ...[
                      Icon(widget.icon, size: 18),
                      const SizedBox(width: 8),
                    ],
                    Text(
                      widget.text,
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: isDark
                            ? AppColors.darkTextPrimary
                            : AppColors.lightTextPrimary,
                      ),
                    ),
                  ],
                ),
        ),
      );
    }

    // ── Primary (gradient) variant ────────────────────────────────
    return GestureDetector(
      onTapDown: _onTapDown,
      onTapUp: _onTapUp,
      onTapCancel: _onTapCancel,
      onTap: _handleTap,
      child: AnimatedScale(
        scale: _pressed ? 0.975 : 1.0,
        duration: const Duration(milliseconds: 110),
        curve: Curves.easeOut,
        child: AnimatedOpacity(
          opacity: _disabled ? 0.55 : 1.0,
          duration: const Duration(milliseconds: 150),
          child: Container(
            height: widget.height,
            width: double.infinity,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: colors,
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(14),
              boxShadow: _disabled
                  ? null
                  : [
                      BoxShadow(
                        color: colors.last.withValues(alpha: 0.32),
                        blurRadius: 18,
                        offset: const Offset(0, 8),
                      ),
                    ],
            ),
            child: Center(child: content),
          ),
        ),
      ),
    );
  }
}
