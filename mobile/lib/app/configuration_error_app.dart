import 'package:flutter/material.dart';

/// Fallback app shown when the build-time API configuration is missing or
/// unsafe.
///
/// It exists so a misconfigured release build fails loudly and locally instead
/// of silently falling back to production or issuing requests to an unknown
/// host. It deliberately contains no networking code.
class ConfigurationErrorApp extends StatelessWidget {
  const ConfigurationErrorApp({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'FinPro',
      debugShowCheckedModeBanner: false,
      home: Scaffold(
        backgroundColor: const Color(0xFF0B1220),
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(28),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  const Icon(
                    Icons.settings_ethernet_rounded,
                    size: 48,
                    color: Color(0xFFF5A524),
                  ),
                  const SizedBox(height: 18),
                  const Text(
                    'Configuration error',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'This build cannot start because its API configuration is '
                    'invalid. Provide a valid HTTPS API base URL at build time '
                    'with --dart-define=API_BASE_URL=... and rebuild.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 14, color: Color(0xFFB6C2D9)),
                  ),
                  const SizedBox(height: 18),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: const Color(0xFF131C31),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: const Color(0xFF23304D)),
                    ),
                    child: Text(
                      message,
                      style: const TextStyle(
                        fontSize: 12.5,
                        color: Color(0xFFE2E8F4),
                        height: 1.4,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
