import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../shared/widgets/financial_card.dart';
import '../../shared/widgets/gradient_button.dart';

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _salaryController = TextEditingController(text: '75000');
  final _cityController = TextEditingController(text: 'Bengaluru');
  final _ageController = TextEditingController(text: '26');
  String _riskTolerance = 'MODERATE';
  bool _isLoading = false;

  @override
  void dispose() {
    _salaryController.dispose();
    _cityController.dispose();
    _ageController.dispose();
    super.dispose();
  }

  Future<void> _handleSubmit() async {
    setState(() => _isLoading = true);
    try {
      final salary = double.tryParse(_salaryController.text) ?? 50000;
      final age = int.tryParse(_ageController.text) ?? 25;
      final city = _cityController.text.trim();

      await apiClient.post(
        ApiEndpoints.onboarding,
        data: {
          'monthlySalary': salary,
          'age': age,
          'city': city.isEmpty ? 'Mumbai' : city,
          'riskTolerance': _riskTolerance,
        },
      );

      if (mounted) {
        context.go('/dashboard');
      }
    } catch (_) {
      // Continue to dashboard even if profile already initialized
      if (mounted) {
        context.go('/dashboard');
      }
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 12),
              Text(
                'Personalize Your Plan',
                style: Theme.of(context).textTheme.displaySmall,
              ),
              const SizedBox(height: 8),
              Text(
                'Help FinPro calculate your financial baseline and custom 50/30/20 budget allocations.',
                style: TextStyle(
                  fontSize: 14,
                  color: isDark
                      ? AppColors.darkTextSecondary
                      : AppColors.lightTextSecondary,
                  height: 1.5,
                ),
              ),
              const SizedBox(height: 28),
              FinancialCard(
                padding: const EdgeInsets.all(22),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Monthly Net Income (₹)',
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 13,
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _salaryController,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        hintText: 'e.g. 75,000',
                        prefixIcon: Icon(
                          Icons.currency_rupee_rounded,
                          size: 20,
                        ),
                      ),
                    ),
                    const SizedBox(height: 18),
                    const Text(
                      'City in India',
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 13,
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _cityController,
                      decoration: const InputDecoration(
                        hintText: 'e.g. Mumbai, Bengaluru, Delhi',
                        prefixIcon: Icon(Icons.location_city_rounded, size: 20),
                      ),
                    ),
                    const SizedBox(height: 18),
                    const Text(
                      'Your Age',
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 13,
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _ageController,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        hintText: 'e.g. 26',
                        prefixIcon: Icon(
                          Icons.calendar_today_rounded,
                          size: 20,
                        ),
                      ),
                    ),
                    const SizedBox(height: 18),
                    const Text(
                      'Investment Risk Style',
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 13,
                      ),
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        _buildChoiceChip('CONSERVATIVE', 'Calm'),
                        const SizedBox(width: 8),
                        _buildChoiceChip('MODERATE', 'Balanced'),
                        const SizedBox(width: 8),
                        _buildChoiceChip('AGGRESSIVE', 'Growth'),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 32),
              GradientButton(
                text: 'Generate My Financial Plan',
                isLoading: _isLoading,
                onPressed: _handleSubmit,
              ),
              const SizedBox(height: 16),
              Center(
                child: TextButton(
                  onPressed: () => context.go('/dashboard'),
                  child: const Text('Skip for now'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildChoiceChip(String value, String label) {
    final isSelected = _riskTolerance == value;
    return Expanded(
      child: InkWell(
        onTap: () => setState(() => _riskTolerance = value),
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            color: isSelected ? AppColors.primary : Colors.transparent,
            border: Border.all(
              color: isSelected ? AppColors.primary : AppColors.darkBorder,
            ),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 13,
              fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
              color: isSelected ? Colors.white : AppColors.darkTextSecondary,
            ),
          ),
        ),
      ),
    );
  }
}
