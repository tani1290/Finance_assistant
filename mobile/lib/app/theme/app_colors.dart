import 'package:flutter/material.dart';

/// Central design tokens for FinPro.
///
/// The palette is intentionally small and semantic. Dark mode is the default
/// ("premium") experience; every token therefore has a dark + light variant and
/// screens should resolve them through the `isDark` flag (or the helpers below)
/// rather than hard-coding one theme.
class AppColors {
  AppColors._();

  // ─────────────────────────────────────────────────────────────
  // Brand & Primary
  // ─────────────────────────────────────────────────────────────
  static const Color primary = Color(0xFF059669);
  static const Color primaryLight = Color(0xFF10B981);
  static const Color primaryDark = Color(0xFF047857);
  static const Color primarySubtle = Color(0xFF064E3B);
  static const Color primaryWash = Color(0x1A10B981);

  // ─────────────────────────────────────────────────────────────
  // Dark Theme Palette (Default)
  // ─────────────────────────────────────────────────────────────
  static const Color darkBg = Color(0xFF0A0F1D);
  static const Color darkBgElevated = Color(0xFF0D1426);
  static const Color darkSurface = Color(0xFF131C31);
  static const Color darkSurfaceSubtle = Color(0xFF1E293B);
  static const Color darkSurfaceElevated = Color(0xFF18233D);
  static const Color darkBorder = Color(0xFF334155);
  static const Color darkBorderSubtle = Color(0xFF1E293B);
  static const Color darkTextPrimary = Color(0xFFF8FAFC);
  static const Color darkTextSecondary = Color(0xFF94A3B8);
  static const Color darkTextMuted = Color(0xFF64748B);

  // ─────────────────────────────────────────────────────────────
  // Light Theme Palette
  // ─────────────────────────────────────────────────────────────
  static const Color lightBg = Color(0xFFF6F8FB);
  static const Color lightSurface = Color(0xFFFFFFFF);
  static const Color lightSurfaceSubtle = Color(0xFFF1F5F9);
  static const Color lightSurfaceElevated = Color(0xFFFFFFFF);
  static const Color lightBorder = Color(0xFFE2E8F0);
  static const Color lightBorderSubtle = Color(0xFFEDF2F7);
  static const Color lightTextPrimary = Color(0xFF0F172A);
  static const Color lightTextSecondary = Color(0xFF475569);
  static const Color lightTextMuted = Color(0xFF64748B);

  // ─────────────────────────────────────────────────────────────
  // Financial Semantic Accents
  // ─────────────────────────────────────────────────────────────
  static const Color income = Color(0xFF10B981);
  static const Color expense = Color(0xFFEF4444);
  static const Color warning = Color(0xFFF59E0B);
  static const Color info = Color(0xFF0284C7);
  static const Color purple = Color(0xFF8B5CF6);
  static const Color indigo = Color(0xFF6366F1);
  static const Color teal = Color(0xFF14B8A6);
  static const Color gold = Color(0xFFEAB308);

  // Soft Badges
  static const Color incomeBadgeBg = Color(0x1F10B981);
  static const Color expenseBadgeBg = Color(0x1FEF4444);
  static const Color pendingBadgeBg = Color(0x1FF59E0B);

  // ─────────────────────────────────────────────────────────────
  // Gradients
  // ─────────────────────────────────────────────────────────────
  static const List<Color> primaryGradient = [primary, primaryLight];
  static const List<Color> brandGradient = [
    Color(0xFF047857),
    Color(0xFF059669),
    Color(0xFF10B981),
  ];
  static const List<Color> heroGradientDark = [
    Color(0xFF0C2536),
    Color(0xFF10322C),
    Color(0xFF0E2B1E),
  ];
  static const List<Color> heroGradientLight = [
    Color(0xFFE4F5EF),
    Color(0xFFEAF6E6),
  ];
  static const List<Color> goldGradient = [
    Color(0xFFF59E0B),
    Color(0xFFEAB308),
  ];
  static const List<Color> premiumGradient = [
    Color(0xFF8B5CF6),
    Color(0xFF6366F1),
  ];
  static const List<Color> expenseGradient = [
    Color(0xFFEF4444),
    Color(0xFFF97316),
  ];

  // ─────────────────────────────────────────────────────────────
  // Depth & Glass
  // ─────────────────────────────────────────────────────────────
  static const Color shadowColor = Color(0xFF000000);
  static const Color glassLight = Color(0x1AFFFFFF);
  static const Color glassDark = Color(0x0DFFFFFF);
  static const Color scrim = Color(0xCC05080F);

  // ─────────────────────────────────────────────────────────────
  // Theme-aware helpers
  // ─────────────────────────────────────────────────────────────
  static Color bg(bool isDark) => isDark ? darkBg : lightBg;
  static Color surface(bool isDark) => isDark ? darkSurface : lightSurface;
  static Color surfaceElevated(bool isDark) =>
      isDark ? darkSurfaceElevated : lightSurfaceElevated;
  static Color surfaceSubtle(bool isDark) =>
      isDark ? darkSurfaceSubtle : lightSurfaceSubtle;
  static Color border(bool isDark) => isDark ? darkBorder : lightBorder;
  static Color textPrimary(bool isDark) =>
      isDark ? darkTextPrimary : lightTextPrimary;
  static Color textSecondary(bool isDark) =>
      isDark ? darkTextSecondary : lightTextSecondary;
  static Color textMuted(bool isDark) =>
      isDark ? darkTextMuted : lightTextMuted;

  /// Soft ambient elevation shadow used by cards & sheets.
  static List<BoxShadow> shadow(bool isDark, {double strength = 1}) {
    return [
      BoxShadow(
        color: shadowColor.withValues(alpha: isDark ? 0.28 * strength : 0.06 * strength),
        blurRadius: 20 * strength,
        offset: Offset(0, 8 * strength),
      ),
    ];
  }

  /// Coloured glow used behind hero / primary surfaces.
  static List<BoxShadow> glow(Color color, {double strength = 1}) {
    return [
      BoxShadow(
        color: color.withValues(alpha: 0.32 * strength),
        blurRadius: 26 * strength,
        offset: Offset(0, 10 * strength),
      ),
    ];
  }
}
