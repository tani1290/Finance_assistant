import 'package:finpro_mobile/core/api/api_endpoints.dart';
import 'package:finpro_mobile/core/config/app_environment.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('AppEnvironment.resolve', () {
    test('non-release defaults to a local backend', () {
      final android = AppEnvironment.resolve(
        isRelease: false,
        platform: TargetPlatform.android,
      );
      expect(android, 'http://10.0.2.2:5001/api/v1');

      final ios = AppEnvironment.resolve(
        isRelease: false,
        platform: TargetPlatform.iOS,
      );
      expect(ios, 'http://127.0.0.1:5001/api/v1');
    });

    test('an explicit override wins in non-release builds', () {
      final resolved = AppEnvironment.resolve(
        isRelease: false,
        override: 'http://192.168.1.5:5001/api/v1',
      );
      expect(resolved, 'http://192.168.1.5:5001/api/v1');
    });

    test('release defaults to the production HTTPS endpoint', () {
      final resolved = AppEnvironment.resolve(isRelease: true);
      expect(resolved, AppEnvironment.productionBaseUrl);
      expect(resolved.startsWith('https://'), isTrue);
    });

    test('a blank override falls back instead of producing an empty URL', () {
      final resolved = AppEnvironment.resolve(isRelease: false, override: '  ');
      expect(resolved, startsWith('http://'));
    });

    test('release rejects a plaintext HTTP override', () {
      expect(
        () => AppEnvironment.resolve(
          isRelease: true,
          override: 'http://finpro-finance-ai.onrender.com/api/v1',
        ),
        throwsA(isA<ApiConfigurationException>()),
      );
    });

    test('release accepts an explicit HTTPS override', () {
      final resolved = AppEnvironment.resolve(
        isRelease: true,
        override: 'https://api.example.com/api/v1/',
      );
      expect(resolved, 'https://api.example.com/api/v1');
    });
  });

  group('AppEnvironment.validate', () {
    test('rejects empty, relative, and hostless URLs', () {
      expect(
        () => AppEnvironment.validate('', isRelease: false),
        throwsA(isA<ApiConfigurationException>()),
      );
      expect(
        () => AppEnvironment.validate('/api/v1', isRelease: false),
        throwsA(isA<ApiConfigurationException>()),
      );
      expect(
        () => AppEnvironment.validate('https:///api/v1', isRelease: false),
        throwsA(isA<ApiConfigurationException>()),
      );
    });

    test('rejects non-http schemes and embedded credentials', () {
      expect(
        () => AppEnvironment.validate('ftp://host/api/v1', isRelease: false),
        throwsA(isA<ApiConfigurationException>()),
      );
      expect(
        () => AppEnvironment.validate(
          'https://user:pass@host/api/v1',
          isRelease: false,
        ),
        throwsA(isA<ApiConfigurationException>()),
      );
    });

    test('rejects query strings and fragments', () {
      expect(
        () => AppEnvironment.validate(
          'https://host/api/v1?debug=1',
          isRelease: false,
        ),
        throwsA(isA<ApiConfigurationException>()),
      );
      expect(
        () => AppEnvironment.validate(
          'https://host/api/v1#frag',
          isRelease: false,
        ),
        throwsA(isA<ApiConfigurationException>()),
      );
    });

    test('requires the /api/v1 path suffix', () {
      expect(
        () => AppEnvironment.validate('https://host', isRelease: false),
        throwsA(isA<ApiConfigurationException>()),
      );
      expect(
        () => AppEnvironment.validate('https://host/other', isRelease: false),
        throwsA(isA<ApiConfigurationException>()),
      );
    });

    test('normalizes trailing slashes', () {
      expect(
        AppEnvironment.validate('https://host/api/v1///', isRelease: true),
        'https://host/api/v1',
      );
    });
  });

  group('AppEnvironment.normalizeForRuntime', () {
    test(
      'accepts a host without the api suffix and strips trailing slashes',
      () {
        expect(
          AppEnvironment.normalizeForRuntime('http://10.0.2.2:5001/'),
          'http://10.0.2.2:5001',
        );
      },
    );

    test('rejects malformed runtime overrides', () {
      expect(
        () => AppEnvironment.normalizeForRuntime('not a url'),
        throwsA(isA<ApiConfigurationException>()),
      );
      expect(
        () => AppEnvironment.normalizeForRuntime('ftp://host'),
        throwsA(isA<ApiConfigurationException>()),
      );
    });
  });

  group('ApiEndpoints.baseUrl', () {
    tearDown(ApiEndpoints.resetBaseUrl);

    test('resolves lazily to the local non-release default', () {
      ApiEndpoints.resetBaseUrl();
      expect(ApiEndpoints.baseUrl, startsWith('http://'));
      expect(ApiEndpoints.baseUrl, endsWith('/api/v1'));
    });

    test('accepts a valid runtime override', () {
      ApiEndpoints.baseUrl = 'http://192.168.0.10:5001/api/v1';
      expect(ApiEndpoints.baseUrl, 'http://192.168.0.10:5001/api/v1');
      expect(ApiEndpoints.login, 'http://192.168.0.10:5001/api/v1/auth/login');
    });

    test('rejects a malformed runtime override', () {
      expect(
        () => ApiEndpoints.baseUrl = 'nonsense',
        throwsA(isA<ApiConfigurationException>()),
      );
    });
  });
}
