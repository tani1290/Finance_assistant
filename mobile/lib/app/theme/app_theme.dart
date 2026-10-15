import 'package:flutter/material.dart';
import 'app_colors.dart';
import 'app_typography.dart';

/// FinPro application theme.
///
/// Every Material component is themed here so individual screens never need to
/// hand-roll styling — that keeps the product visually consistent and makes the
/// "premium" feel automatic across the whole app.
class AppTheme {
  AppTheme._();

  static const double radiusSm = 10;
  static const double radiusMd = 14;
  static const double radiusLg = 20;
  static const double radiusXl = 28;

  static ThemeData darkTheme() => _build(isDark: true);

  static ThemeData lightTheme() => _build(isDark: false);

  static ThemeData _build({required bool isDark}) {
    final bg = AppColors.bg(isDark);
    final surface = AppColors.surface(isDark);
    final border = AppColors.border(isDark);
    final textPrimary = AppColors.textPrimary(isDark);
    final textSecondary = AppColors.textSecondary(isDark);
    final textMuted = AppColors.textMuted(isDark);
    final accent = isDark ? AppColors.primaryLight : AppColors.primary;

    final colorScheme = isDark
        ? const ColorScheme.dark(
            primary: AppColors.primaryLight,
            onPrimary: Colors.white,
            secondary: AppColors.primary,
            surface: AppColors.darkSurface,
            onSurface: AppColors.darkTextPrimary,
            error: AppColors.expense,
          )
        : const ColorScheme.light(
            primary: AppColors.primary,
            onPrimary: Colors.white,
            secondary: AppColors.primaryDark,
            surface: AppColors.lightSurface,
            onSurface: AppColors.lightTextPrimary,
            error: AppColors.expense,
          );

    return ThemeData(
      useMaterial3: true,
      brightness: isDark ? Brightness.dark : Brightness.light,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: bg,
      canvasColor: bg,
      splashFactory: InkSparkle.splashFactory,
      visualDensity: VisualDensity.standard,
      textTheme: AppTypography.textTheme(isDark),
      primaryTextTheme: AppTypography.textTheme(isDark),

      // ── App bar ────────────────────────────────────────────────
      appBarTheme: AppBarTheme(
        backgroundColor: bg,
        surfaceTintColor: Colors.transparent,
        scrolledUnderElevation: 0,
        elevation: 0,
        centerTitle: false,
        iconTheme: IconThemeData(color: textPrimary),
        actionsIconTheme: IconThemeData(color: textPrimary),
        titleTextStyle: TextStyle(
          color: textPrimary,
          fontSize: 18,
          fontWeight: FontWeight.w600,
        ),
      ),

      // ── Cards ──────────────────────────────────────────────────
      cardTheme: CardThemeData(
        color: surface,
        elevation: 0,
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusLg),
          side: BorderSide(color: border, width: 1),
        ),
        margin: EdgeInsets.zero,
      ),

      // ── Bottom navigation ──────────────────────────────────────
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: Colors.transparent,
        elevation: 0,
        height: 68,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        indicatorColor: accent.withValues(alpha: 0.16),
        indicatorShape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusMd),
        ),
        iconTheme: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return IconThemeData(
            size: 24,
            color: selected ? accent : textMuted,
          );
        }),
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return TextStyle(
            fontSize: 11.5,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
            color: selected ? accent : textMuted,
          );
        }),
      ),

      // ── Inputs ─────────────────────────────────────────────────
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isDark ? AppColors.darkSurfaceSubtle : AppColors.lightSurface,
        hintStyle: TextStyle(color: textMuted, fontSize: 14),
        labelStyle: TextStyle(color: textSecondary, fontSize: 14),
        floatingLabelStyle: TextStyle(color: accent, fontSize: 14),
        prefixIconColor: textMuted,
        suffixIconColor: textMuted,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          borderSide: BorderSide(color: border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          borderSide: BorderSide(color: border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          borderSide: BorderSide(color: accent, width: 1.6),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          borderSide: const BorderSide(color: AppColors.expense),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          borderSide: const BorderSide(color: AppColors.expense, width: 1.6),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      ),

      // ── Buttons ────────────────────────────────────────────────
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: accent,
          foregroundColor: Colors.white,
          elevation: 0,
          minimumSize: const Size(0, 50),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(radiusMd),
          ),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: accent,
          foregroundColor: Colors.white,
          minimumSize: const Size(0, 50),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(radiusMd),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: textPrimary,
          minimumSize: const Size(0, 50),
          side: BorderSide(color: border),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(radiusMd),
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: accent,
          textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(radiusSm),
          ),
        ),
      ),
      iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(
          foregroundColor: textPrimary,
          highlightColor: accent.withValues(alpha: 0.12),
        ),
      ),

      // ── Snackbars ──────────────────────────────────────────────
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: isDark ? AppColors.darkSurfaceElevated : const Color(0xFF1E293B),
        contentTextStyle: const TextStyle(
          color: Colors.white,
          fontSize: 13.5,
          fontWeight: FontWeight.w500,
        ),
        actionTextColor: accent,
        elevation: 6,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusMd),
        ),
        insetPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      ),

      // ── Dialogs & sheets ───────────────────────────────────────
      dialogTheme: DialogThemeData(
        backgroundColor: surface,
        surfaceTintColor: Colors.transparent,
        elevation: 8,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusLg),
        ),
        titleTextStyle: TextStyle(
          color: textPrimary,
          fontSize: 17,
          fontWeight: FontWeight.w700,
        ),
        contentTextStyle: TextStyle(
          color: textSecondary,
          fontSize: 14,
          height: 1.5,
        ),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        showDragHandle: true,
        dragHandleColor: border,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(radiusXl)),
        ),
      ),

      // ── Misc ───────────────────────────────────────────────────
      dividerTheme: DividerThemeData(
        color: isDark ? AppColors.darkBorderSubtle : AppColors.lightBorder,
        thickness: 1,
        space: 1,
      ),
      chipTheme: ChipThemeData(
        backgroundColor: isDark ? AppColors.darkSurfaceSubtle : AppColors.lightSurfaceSubtle,
        selectedColor: accent.withValues(alpha: 0.18),
        side: BorderSide(color: border),
        labelStyle: TextStyle(
          color: textSecondary,
          fontSize: 12.5,
          fontWeight: FontWeight.w600,
        ),
        secondaryLabelStyle: TextStyle(color: accent, fontSize: 12.5),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusMd),
        ),
      ),
      listTileTheme: ListTileThemeData(
        iconColor: textSecondary,
        textColor: textPrimary,
        titleTextStyle: TextStyle(
          color: textPrimary,
          fontSize: 14,
          fontWeight: FontWeight.w600,
        ),
        subtitleTextStyle: TextStyle(color: textSecondary, fontSize: 12.5),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusMd),
        ),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: accent,
        linearTrackColor: accent.withValues(alpha: 0.15),
        circularTrackColor: Colors.transparent,
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected) ? Colors.white : textMuted,
        ),
        trackColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? accent
              : (isDark ? AppColors.darkSurfaceSubtle : AppColors.lightSurfaceSubtle),
        ),
        trackOutlineColor: WidgetStatePropertyAll(border),
      ),
      tabBarTheme: TabBarThemeData(
        labelColor: accent,
        unselectedLabelColor: textMuted,
        indicatorColor: accent,
        dividerColor: Colors.transparent,
        labelStyle: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700),
        unselectedLabelStyle: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500),
      ),
      tooltipTheme: TooltipThemeData(
        decoration: BoxDecoration(
          color: isDark ? AppColors.darkSurfaceElevated : const Color(0xFF1E293B),
          borderRadius: BorderRadius.circular(radiusSm),
        ),
        textStyle: const TextStyle(color: Colors.white, fontSize: 12),
      ),
      scrollbarTheme: ScrollbarThemeData(
        thumbColor: WidgetStatePropertyAll(
          textMuted.withValues(alpha: 0.5),
        ),
        radius: const Radius.circular(8),
        thickness: const WidgetStatePropertyAll(6),
      ),
      textSelectionTheme: TextSelectionThemeData(
        cursorColor: accent,
        selectionColor: accent.withValues(alpha: 0.3),
        selectionHandleColor: accent,
      ),

      // ── Motion ─────────────────────────────────────────────────
      pageTransitionsTheme: const PageTransitionsTheme(
        builders: {
          TargetPlatform.android: _FadeSlidePageTransitionsBuilder(),
          TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
          TargetPlatform.macOS: CupertinoPageTransitionsBuilder(),
          TargetPlatform.windows: _FadeSlidePageTransitionsBuilder(),
          TargetPlatform.linux: _FadeSlidePageTransitionsBuilder(),
        },
      ),
    );
  }
}

/// A calm, branded page transition: content fades in while easing up a touch.
class _FadeSlidePageTransitionsBuilder extends PageTransitionsBuilder {
  const _FadeSlidePageTransitionsBuilder();

  @override
  Widget buildTransitions<T>(
    PageRoute<T> route,
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    final curved = CurvedAnimation(
      parent: animation,
      curve: Curves.easeOutCubic,
      reverseCurve: Curves.easeInCubic,
    );
    return FadeTransition(
      opacity: curved,
      child: SlideTransition(
        position: Tween<Offset>(
          begin: const Offset(0, 0.03),
          end: Offset.zero,
        ).animate(curved),
        child: child,
      ),
    );
  }
}
