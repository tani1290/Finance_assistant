import 'package:flutter/material.dart';
import '../../app/theme/app_colors.dart';

/// A shimmering placeholder used while content loads.
///
/// Same public API as before (`width`, `height`, `borderRadius`) but the effect
/// is now a sweeping highlight instead of a flat opacity pulse — the tell of a
/// polished, production app.
class SkeletonLoader extends StatefulWidget {
  final double width;
  final double height;
  final double borderRadius;

  const SkeletonLoader({
    super.key,
    required this.width,
    required this.height,
    this.borderRadius = 8,
  });

  @override
  State<SkeletonLoader> createState() => _SkeletonLoaderState();
}

class _SkeletonLoaderState extends State<SkeletonLoader>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1500),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final base = isDark ? AppColors.darkSurfaceSubtle : AppColors.lightSurfaceSubtle;
    final highlight = isDark ? AppColors.darkSurfaceElevated : Colors.white;

    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        return Container(
          width: widget.width,
          height: widget.height,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(widget.borderRadius),
            gradient: LinearGradient(
              colors: [base, highlight, base],
              stops: const [0.35, 0.5, 0.65],
              begin: Alignment.centerLeft,
              end: Alignment.centerRight,
              transform: _SlideGradientTransform(_controller.value),
            ),
          ),
        );
      },
    );
  }
}

/// Sweeps a gradient highlight horizontally across its parent's bounds.
class _SlideGradientTransform extends GradientTransform {
  final double t;
  const _SlideGradientTransform(this.t);

  @override
  Matrix4? transform(Rect bounds, {TextDirection? textDirection}) {
    // Move the gradient from -1.5x to +1.5x of the width so the highlight
    // fully enters and exits the visible area.
    return Matrix4.translationValues(bounds.width * (t * 3 - 1.5), 0, 0);
  }
}
