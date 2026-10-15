import 'package:flutter/material.dart';
import '../../app/theme/app_colors.dart';
import 'pressable.dart';

/// The core surface used across FinPro.
///
/// Keeps the original API (`child`, `padding`, `onTap`, `backgroundColor`,
/// `border`) and adds optional polish: a gradient fill, an accent tint, soft
/// elevation and a proper Material ripple that is actually visible above the
/// card background.
class FinancialCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  final Color? backgroundColor;
  final Border? border;

  /// Optional gradient fill (takes precedence over [backgroundColor]).
  final List<Color>? gradient;

  /// Optional accent colour; renders a subtle tinted wash from the top-left.
  final Color? accent;

  /// Soft ambient elevation (on by default for a "lifted" premium feel).
  final bool elevated;

  final double radius;

  const FinancialCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(20),
    this.onTap,
    this.backgroundColor,
    this.border,
    this.gradient,
    this.accent,
    this.elevated = true,
    this.radius = 18,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bg = backgroundColor ?? (isDark ? AppColors.darkSurface : AppColors.lightSurface);
    final b = border ??
        Border.all(
          color: isDark ? AppColors.darkBorder : AppColors.lightBorder,
          width: 1,
        );

    final decoration = BoxDecoration(
      color: gradient == null ? bg : null,
      gradient: gradient != null
          ? LinearGradient(
              colors: gradient!,
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            )
          : (accent != null
                ? LinearGradient(
                    colors: [
                      Color.alphaBlend(accent!.withValues(alpha: 0.10), bg),
                      bg,
                    ],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  )
                : null),
      borderRadius: BorderRadius.circular(radius),
      border: b,
      boxShadow: elevated ? AppColors.shadow(isDark) : null,
    );

    Widget content = Padding(padding: padding, child: child);

    if (onTap != null) {
      content = ClipRRect(
        borderRadius: BorderRadius.circular(radius),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onTap,
            splashColor: (accent ?? AppColors.primary).withValues(alpha: 0.12),
            highlightColor: (accent ?? AppColors.primary).withValues(alpha: 0.06),
            child: content,
          ),
        ),
      );
    }

    final card = Container(decoration: decoration, child: content);

    if (onTap != null) {
      return Pressable(
        onTap: onTap,
        borderRadius: BorderRadius.circular(radius),
        child: card,
      );
    }

    return card;
  }
}
