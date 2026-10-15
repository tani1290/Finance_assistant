import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/auth/auth_notifier.dart';
import '../../core/auth/auth_state.dart';

class SplashScreen extends ConsumerStatefulWidget {
  const SplashScreen({super.key});

  @override
  ConsumerState<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends ConsumerState<SplashScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1000),
  )..forward();

  late final Animation<double> _fade = CurvedAnimation(
    parent: _controller,
    curve: const Interval(0.0, 0.6, curve: Curves.easeOut),
  );

  late final Animation<double> _scale = Tween<double>(begin: 0.85, end: 1.0)
      .animate(
        CurvedAnimation(parent: _controller, curve: Curves.easeOutBack),
      );

  late final Animation<double> _rise = Tween<double>(begin: 16, end: 0).animate(
    CurvedAnimation(
      parent: _controller,
      curve: const Interval(0.2, 1.0, curve: Curves.easeOutCubic),
    ),
  );

  @override
  void initState() {
    super.initState();
    _checkInit();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _checkInit() async {
    await Future.delayed(const Duration(milliseconds: 1400));
    if (!mounted) return;

    final authState = ref.read(authProvider);
    if (authState.isAuthenticated) {
      context.go('/dashboard');
    } else {
      context.go('/login');
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(authProvider, (previous, next) {
      if (next.status == AuthStatus.authenticated) {
        context.go('/dashboard');
      } else if (next.status == AuthStatus.unauthenticated) {
        context.go('/login');
      }
    });

    return Scaffold(
      backgroundColor: AppColors.darkBg,
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            colors: [AppColors.darkBg, Color(0xFF0C1B2A), Color(0xFF0A1F1A)],
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
        child: Stack(
          children: [
            // Soft brand glow behind the mark.
            Positioned(
              top: MediaQuery.of(context).size.height * 0.32,
              left: 0,
              right: 0,
              child: Center(
                child: AnimatedBuilder(
                  animation: _controller,
                  builder: (context, _) => Container(
                    width: 220,
                    height: 220,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: RadialGradient(
                        colors: [
                          AppColors.primaryLight.withValues(alpha: 0.20 * _fade.value),
                          Colors.transparent,
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
            Center(
              child: FadeTransition(
                opacity: _fade,
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    ScaleTransition(
                      scale: _scale,
                      child: Container(
                        width: 88,
                        height: 88,
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            colors: AppColors.brandGradient,
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                          ),
                          borderRadius: BorderRadius.circular(24),
                          boxShadow: AppColors.glow(AppColors.primaryLight, strength: 1.4),
                        ),
                        child: const Icon(
                          Icons.account_balance_wallet_rounded,
                          size: 44,
                          color: Colors.white,
                        ),
                      ),
                    ),
                    const SizedBox(height: 26),
                    AnimatedBuilder(
                      animation: _rise,
                      builder: (context, child) => Transform.translate(
                        offset: Offset(0, _rise.value),
                        child: child,
                      ),
                      child: const Column(
                        children: [
                          Text(
                            'FinPro',
                            style: TextStyle(
                              fontSize: 30,
                              fontWeight: FontWeight.w700,
                              color: AppColors.darkTextPrimary,
                              letterSpacing: -0.6,
                            ),
                          ),
                          SizedBox(height: 8),
                          Text(
                            'Calm, Intelligent Personal Finance',
                            style: TextStyle(
                              fontSize: 14,
                              color: AppColors.darkTextSecondary,
                              letterSpacing: 0.1,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 52),
                    const SizedBox(
                      width: 26,
                      height: 26,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.4,
                        color: AppColors.primaryLight,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
