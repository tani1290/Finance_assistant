import 'model_parse.dart';

class UserModel {
  final String id;
  final String email;
  final String username;
  final String firstName;
  final String lastName;
  final String currency;
  final bool isPremium;

  UserModel({
    required this.id,
    required this.email,
    required this.username,
    required this.firstName,
    required this.lastName,
    this.currency = 'INR',
    this.isPremium = false,
  });

  String get fullName {
    if (firstName.isEmpty && lastName.isEmpty) return username;
    return '$firstName $lastName'.trim();
  }

  factory UserModel.fromJson(Map<String, dynamic> json) {
    const model = 'UserModel';
    return UserModel(
      id: parseRequiredString(json, 'id', model: model),
      email: parseRequiredString(json, 'email', model: model),
      username: json['username'] ?? json['email'] ?? 'User',
      firstName: json['firstName'] ?? '',
      lastName: json['lastName'] ?? '',
      currency: json['currency'] ?? 'INR',
      isPremium: json['isPremium'] ?? false,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'email': email,
      'username': username,
      'firstName': firstName,
      'lastName': lastName,
      'currency': currency,
      'isPremium': isPremium,
    };
  }
}
