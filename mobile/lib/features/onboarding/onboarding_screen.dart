import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_endpoints.dart';
import '../../core/api/api_error.dart';
import '../../shared/widgets/financial_card.dart';
import '../../shared/widgets/gradient_button.dart';
import '../../shared/widgets/pressable.dart';

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _salaryController = TextEditingController();
  final _cityController = TextEditingController();
  final _ageController = TextEditingController();
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
    final salary = double.tryParse(_salaryController.text.trim());
    final age = int.tryParse(_ageController.text.trim());
    final city = _cityController.text.trim();

    String? validationError;
    if (salary == null || salary <= 0) {
      validationError = 'Enter your monthly salary.';
    } else if (age == null || age < 18 || age > 100) {
      validationError = 'Enter a valid age between 18 and 100.';
    } else if (city.isEmpty) {
      validationError = 'Enter your city.';
    }
    if (validationError != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(validationError)),
      );
      return;
    }

    setState(() => _isLoading = true);
    try {
      await apiClient.post(
        ApiEndpoints.onboarding,
        data: {
          'monthlySalary': salary,
          'age': age,
          'city': city,
          'riskTolerance': _riskTolerance,
        },
      );

      if (!mounted) return;
      context.go('/dashboard');
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            apiErrorMessage(error) ??
                'Your profile could not be saved. Check your connection and try again.',
          ),
        ),
      );
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
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: AppColors.primaryGradient,
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(15),
                  boxShadow: AppColors.glow(AppColors.primary, strength: 0.5),
                ),
                child: const Icon(
                  Icons.tune_rounded,
                  color: Colors.white,
                  size: 26,
                ),
              ),
              const SizedBox(height: 20),
              Text(
                'Personalize Your Plan',
                style: Theme.of(context).textTheme.displaySmall,
              ),
              const SizedBox(height: 8),
              Text(
                'Help FinPro calculate your financial baseline and custom 50/30/20 budget allocations.',
                style: TextStyle(
                  fontSize: 14,
                  color: AppColors.textSecondary(isDark),
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
                        _buildChoiceChip(isDark, 'CONSERVATIVE', 'Calm'),
                        const SizedBox(width: 8),
                        _buildChoiceChip(isDark, 'MODERATE', 'Balanced'),
                        const SizedBox(width: 8),
                        _buildChoiceChip(isDark, 'AGGRESSIVE', 'Growth'),
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

  Widget _buildChoiceChip(bool isDark, String value, String label) {
    final isSelected = _riskTolerance == value;
    return Expanded(
      child: Pressable(
        onTap: () => setState(() => _riskTolerance = value),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            gradient: isSelected
                ? const LinearGradient(
                    colors: AppColors.primaryGradient,
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  )
                : null,
            color: isSelected ? null : AppColors.surfaceSubtle(isDark),
            border: Border.all(
              color: isSelected ? AppColors.primary : AppColors.border(isDark),
            ),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 13,
              fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
              color: isSelected ? Colors.white : AppColors.textSecondary(isDark),
            ),
          ),
        ),
      ),
    );
  }
}
