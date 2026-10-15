import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'app_colors.dart';

/// Typographic scale for FinPro.
///
/// `Outfit` is used for display / headings (geometric, confident) and `Inter`
/// for body & UI text (high legibility at small sizes). Sizes are tuned for a
/// mobile-first product so the hierarchy stays crisp on 5.5"–6.7" screens.
class AppTypography {
  AppTypography._();

  static TextTheme textTheme(bool isDark) {
    final textColor = isDark ? AppColors.darkTextPrimary : AppColors.lightTextPrimary;
    final secondaryColor =
        isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary;
    final mutedColor = isDark ? AppColors.darkTextMuted : AppColors.lightTextMuted;

    return TextTheme(
      // Display / hero numerals
      displayLarge: GoogleFonts.outfit(
        fontSize: 40,
        fontWeight: FontWeight.w700,
        color: textColor,
        letterSpacing: -1.0,
        height: 1.1,
      ),
      displayMedium: GoogleFonts.outfit(
        fontSize: 32,
        fontWeight: FontWeight.w700,
        color: textColor,
        letterSpacing: -0.7,
        height: 1.15,
      ),
      displaySmall: GoogleFonts.outfit(
        fontSize: 26,
        fontWeight: FontWeight.w700,
        color: textColor,
        letterSpacing: -0.4,
        height: 1.2,
      ),

      // Headings
      headlineLarge: GoogleFonts.outfit(
        fontSize: 22,
        fontWeight: FontWeight.w700,
        color: textColor,
        letterSpacing: -0.2,
        height: 1.25,
      ),
      headlineMedium: GoogleFonts.outfit(
        fontSize: 18,
        fontWeight: FontWeight.w600,
        color: textColor,
        letterSpacing: -0.1,
      ),
      headlineSmall: GoogleFonts.outfit(
        fontSize: 16,
        fontWeight: FontWeight.w600,
        color: textColor,
      ),

      // Titles
      titleLarge: GoogleFonts.outfit(
        fontSize: 16,
        fontWeight: FontWeight.w600,
        color: textColor,
      ),
      titleMedium: GoogleFonts.inter(
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: textColor,
      ),
      titleSmall: GoogleFonts.inter(
        fontSize: 13,
        fontWeight: FontWeight.w600,
        color: textColor,
      ),

      // Body
      bodyLarge: GoogleFonts.inter(
        fontSize: 15,
        fontWeight: FontWeight.w400,
        color: textColor,
        height: 1.5,
      ),
      bodyMedium: GoogleFonts.inter(
        fontSize: 13.5,
        fontWeight: FontWeight.w400,
        color: secondaryColor,
        height: 1.45,
      ),
      bodySmall: GoogleFonts.inter(
        fontSize: 12,
        fontWeight: FontWeight.w400,
        color: secondaryColor,
        height: 1.4,
      ),

      // Labels / buttons / captions
      labelLarge: GoogleFonts.inter(
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: textColor,
        letterSpacing: 0.1,
      ),
      labelMedium: GoogleFonts.inter(
        fontSize: 12.5,
        fontWeight: FontWeight.w600,
        color: secondaryColor,
      ),
      labelSmall: GoogleFonts.inter(
        fontSize: 11,
        fontWeight: FontWeight.w600,
        color: mutedColor,
        letterSpacing: 0.4,
      ),
    );
  }
}
