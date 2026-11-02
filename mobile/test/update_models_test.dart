import 'package:flutter_test/flutter_test.dart';
import 'package:finpro_mobile/core/updates/update_models.dart';

void main() {
  group('UpdateModels', () {
    test('ReleaseArtifact parses valid JSON accurately', () {
      final json = {
        'apkUrl': 'https://example.com/app.apk',
        'sha256': '08603bd3695a2962860cf20ed4819e1a7a2d9402211fa65d1b21cb2b9be8a24f',
        'sizeBytes': 59246273,
        'fileName': 'finpro-release.apk',
      };

      final artifact = ReleaseArtifact.fromJson(json);
      expect(artifact, isNotNull);
      expect(artifact!.apkUrl, 'https://example.com/app.apk');
      expect(artifact.downloadUrlForPlatform('android'), 'https://example.com/app.apk');
      expect(artifact.sizeBytes, 59246273);
      expect(artifact.sha256, '08603bd3695a2962860cf20ed4819e1a7a2d9402211fa65d1b21cb2b9be8a24f');
    });

    test('ReleaseArtifact returns null for non-map input', () {
      expect(ReleaseArtifact.fromJson(null), isNull);
      expect(ReleaseArtifact.fromJson('not a map'), isNull);
    });

    test('UpdateCheckResult parses update available envelope', () {
      final json = {
        'status': 'optional',
        'channel': 'production',
        'latest': {
          'version': '1.0.1',
          'buildNumber': 2,
          'critical': false,
          'releaseNotes': [
            'Adopted new release signing certificate.',
            'Offline-first synchronization improvements.',
          ],
          'artifacts': {
            'android': {
              'apkUrl': '/downloads/finpro-1.0.1.apk',
              'sha256': '08603bd3695a2962860cf20ed4819e1a7a2d9402211fa65d1b21cb2b9be8a24f',
              'sizeBytes': 60000000,
            },
          },
        },
      };

      final result = UpdateCheckResult.fromJson(
        json,
        platform: 'android',
        currentVersion: '1.0.0',
        currentBuild: 1,
      );

      expect(result.status, UpdateStatus.optional);
      expect(result.hasUpdate, isTrue);
      expect(result.blocksUsage, isFalse);
      expect(result.latest, isNotNull);
      expect(result.latest!.version, '1.0.1');
      expect(result.latest!.buildNumber, 2);
      expect(result.latest!.releaseNotes.length, 2);
      final androidArt = result.latest!.artifactFor('android');
      expect(androidArt, isNotNull);
      expect(androidArt!.apkUrl, '/downloads/finpro-1.0.1.apk');
    });

    test('UpdateCheckResult marks forced updates correctly', () {
      final json = {
        'status': 'forced',
        'channel': 'production',
        'latest': {
          'version': '2.0.0',
          'buildNumber': 10,
          'critical': true,
          'minimumSupportedVersion': '2.0.0',
          'releaseNotes': ['Breaking security update.'],
          'artifacts': {
            'android': {
              'apkUrl': '/downloads/finpro-2.0.0.apk',
              'sha256': '08603bd3695a2962860cf20ed4819e1a7a2d9402211fa65d1b21cb2b9be8a24f',
              'sizeBytes': 60000000,
            },
          },
        },
      };

      final result = UpdateCheckResult.fromJson(
        json,
        platform: 'android',
        currentVersion: '1.0.0',
        currentBuild: 1,
      );

      expect(result.status, UpdateStatus.forced);
      expect(result.hasUpdate, isTrue);
      expect(result.blocksUsage, isTrue);
    });

    test('UpdateCheckResult handles up-to-date status', () {
      final json = {
        'status': 'up-to-date',
        'channel': 'production',
      };

      final result = UpdateCheckResult.fromJson(
        json,
        platform: 'android',
        currentVersion: '1.0.0',
        currentBuild: 1,
      );

      expect(result.status, UpdateStatus.upToDate);
      expect(result.hasUpdate, isFalse);
    });
  });
}
