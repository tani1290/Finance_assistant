import 'package:go_router/go_router.dart';
import '../features/accounts/accounts_screen.dart';
import '../features/ai_advisor/ai_advisor_screen.dart';
import '../features/auth/login_screen.dart';
import '../features/auth/register_screen.dart';
import '../features/budgets/budgets_screen.dart';
import '../features/budgets/category_detail_screen.dart';
import '../features/dashboard/dashboard_screen.dart';
import '../features/goals/goals_screen.dart';
import '../features/investments/investments_screen.dart';
import '../features/loans/loans_screen.dart';
import '../features/notifications/notifications_screen.dart';
import '../features/onboarding/onboarding_screen.dart';
import '../features/privacy/privacy_permissions_screen.dart';
import '../features/settings/settings_screen.dart';
import '../features/shell/main_shell_screen.dart';
import '../features/sms_detection/pending_sms_screen.dart';
import '../features/splash/splash_screen.dart';
import '../features/sync/sync_status_screen.dart';
import '../features/transactions/transaction_detail_screen.dart';
import '../features/transactions/transactions_screen.dart';

final appRouter = GoRouter(
  initialLocation: '/',
  routes: [
    GoRoute(
      path: '/',
      builder: (context, state) => const SplashScreen(),
    ),
    GoRoute(
      path: '/login',
      builder: (context, state) => const LoginScreen(),
    ),
    GoRoute(
      path: '/register',
      builder: (context, state) => const RegisterScreen(),
    ),
    GoRoute(
      path: '/onboarding',
      builder: (context, state) => const OnboardingScreen(),
    ),

    // Stateful Nested Shell for Bottom Navigation
    StatefulShellRoute.indexedStack(
      builder: (context, state, navigationShell) {
        return MainShellScreen(navigationShell: navigationShell);
      },
      branches: [
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/dashboard',
              builder: (context, state) => const DashboardScreen(),
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/transactions',
              builder: (context, state) => const TransactionsScreen(),
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/budgets',
              builder: (context, state) => const BudgetsScreen(),
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/ai-advisor',
              builder: (context, state) => const AiAdvisorScreen(),
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/settings',
              builder: (context, state) => const SettingsScreen(),
            ),
          ],
        ),
      ],
    ),

    // Push routes
    GoRoute(
      path: '/transactions/:id',
      builder: (context, state) {
        final id = state.pathParameters['id'] ?? '';
        return TransactionDetailScreen(transactionId: id);
      },
    ),
    GoRoute(
      path: '/pending-sms',
      builder: (context, state) => const PendingSmsScreen(),
    ),
    GoRoute(
      path: '/budgets/:id',
      builder: (context, state) {
        final id = state.pathParameters['id'] ?? '';
        final cat = state.uri.queryParameters['category'] ?? 'General';
        return CategoryDetailScreen(budgetId: id, categoryName: cat);
      },
    ),
    GoRoute(
      path: '/accounts',
      builder: (context, state) => const AccountsScreen(),
    ),
    GoRoute(
      path: '/investments',
      builder: (context, state) => const InvestmentsScreen(),
    ),
    GoRoute(
      path: '/goals',
      builder: (context, state) => const GoalsScreen(),
    ),
    GoRoute(
      path: '/loans',
      builder: (context, state) => const LoansScreen(),
    ),
    GoRoute(
      path: '/notifications',
      builder: (context, state) => const NotificationsScreen(),
    ),
    GoRoute(
      path: '/privacy',
      builder: (context, state) => const PrivacyPermissionsScreen(),
    ),
    GoRoute(
      path: '/sync',
      builder: (context, state) => const SyncStatusScreen(),
    ),
  ],
);
