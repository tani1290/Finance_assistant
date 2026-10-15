import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import '../../app/theme/app_colors.dart';

/// The persistent app shell with the primary bottom navigation.
///
/// Colours come from the active theme (so light mode works) and the bar carries
/// a soft top elevation + haptic feedback on every destination change.
class MainShellScreen extends StatelessWidget {
  final StatefulNavigationShell navigationShell;

  const MainShellScreen({super.key, required this.navigationShell});

  static const _destinations = <_NavItem>[
    _NavItem(Icons.home_outlined, Icons.home_rounded, 'Home'),
    _NavItem(Icons.receipt_long_outlined, Icons.receipt_long_rounded, 'Activity'),
    _NavItem(Icons.pie_chart_outline_rounded, Icons.pie_chart_rounded, 'Budgets'),
    _NavItem(Icons.auto_awesome_outlined, Icons.auto_awesome_rounded, 'AI Advisor'),
    _NavItem(Icons.person_outline_rounded, Icons.person_rounded, 'Profile'),
  ];

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final surface = AppColors.surface(isDark);

    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: DecoratedBox(
        decoration: BoxDecoration(
          color: surface,
          border: Border(
            top: BorderSide(
              color: isDark
                  ? AppColors.darkBorderSubtle
                  : AppColors.lightBorderSubtle,
              width: 1,
            ),
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: isDark ? 0.32 : 0.06),
              blurRadius: 22,
              offset: const Offset(0, -6),
            ),
          ],
        ),
        child: NavigationBar(
          selectedIndex: navigationShell.currentIndex,
          onDestinationSelected: (index) {
            HapticFeedback.selectionClick();
            navigationShell.goBranch(
              index,
              initialLocation: index == navigationShell.currentIndex,
            );
          },
          backgroundColor: Colors.transparent,
          destinations: [
            for (final d in _destinations)
              NavigationDestination(
                icon: Icon(d.icon),
                selectedIcon: Icon(d.selectedIcon),
                label: d.label,
              ),
          ],
        ),
      ),
    );
  }
}

class _NavItem {
  final IconData icon;
  final IconData selectedIcon;
  final String label;

  const _NavItem(this.icon, this.selectedIcon, this.label);
}
