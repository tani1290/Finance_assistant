import 'analytics_models.dart' show analyticsDouble;
import 'model_parse.dart';

/// The rich user shape returned by `GET /auth/me` and `PATCH /auth/profile`.
///
/// `authService.sanitizeUser` (used by login/register) omits `profile` and
/// `financialProfile`, so those two blocks are treated as optional here even
/// though `/auth/me` always includes them (possibly `null`).
class UserProfileModel {
  // Identity (read-only in the app).
  final String id;
  final String email;
  final String username;
  final String firstName;
  final String lastName;
  final String? phone;
  final String? avatarUrl;
  final String? role;
  final bool isPremium;
  final String currency;
  final String? country;
  final DateTime? createdAt;

  // Profile block (`occupation`, `bio`).
  final String? occupation;
  final String? bio;

  // Financial profile block.
  final String? city;
  final double? monthlySalary;
  final double? estimatedMonthlyExpenses;
  final String? riskProfile;

  UserProfileModel({
    required this.id,
    required this.email,
    required this.username,
    required this.firstName,
    required this.lastName,
    this.phone,
    this.avatarUrl,
    this.role,
    required this.isPremium,
    required this.currency,
    this.country,
    this.createdAt,
    this.occupation,
    this.bio,
    this.city,
    this.monthlySalary,
    this.estimatedMonthlyExpenses,
    this.riskProfile,
  });

  String get fullName {
    final combined = '$firstName $lastName'.trim();
    if (combined.isEmpty) return username;
    return combined;
  }

  factory UserProfileModel.fromJson(Map<String, dynamic> json) {
    const model = 'UserProfileModel';

    String? optionalString(Object? value) {
      if (value is String && value.trim().isNotEmpty) return value;
      return null;
    }

    final profile = json['profile'];
    final financial = json['financialProfile'];
    final profileMap =
        profile is Map ? Map<String, dynamic>.from(profile) : const {};
    final financialMap =
        financial is Map ? Map<String, dynamic>.from(financial) : const {};

    return UserProfileModel(
      id: parseRequiredString(json, 'id', model: model),
      email: parseRequiredString(json, 'email', model: model),
      username: json['username'] is String ? json['username'] as String : '',
      firstName: json['firstName'] is String ? json['firstName'] as String : '',
      lastName: json['lastName'] is String ? json['lastName'] as String : '',
      phone: optionalString(json['phone']),
      avatarUrl: optionalString(json['avatarUrl']),
      role: optionalString(json['role']),
      isPremium: json['isPremium'] == true,
      currency: json['currency'] is String ? json['currency'] as String : 'INR',
      country: optionalString(json['country']),
      createdAt: json['createdAt'] is String
          ? DateTime.tryParse(json['createdAt'] as String)
          : null,
      occupation: optionalString(profileMap['occupation']),
      bio: optionalString(profileMap['bio']),
      city: optionalString(financialMap['city']),
      monthlySalary: analyticsDouble(financialMap['monthlySalary']),
      estimatedMonthlyExpenses:
          analyticsDouble(financialMap['estimatedMonthlyExpenses']),
      riskProfile: optionalString(financialMap['riskProfile']),
    );
  }
}
