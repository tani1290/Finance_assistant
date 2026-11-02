'use strict';

const releaseService = require('../services/releaseService');

describe('releaseService', () => {
  describe('compareVersions', () => {
    test('compares semantic versions accurately', () => {
      expect(releaseService.compareVersions('1.0.0', '1.0.0')).toBe(0);
      expect(releaseService.compareVersions('1.1.0', '1.0.0')).toBeGreaterThan(0);
      expect(releaseService.compareVersions('1.0.0', '1.1.0')).toBeLessThan(0);
      expect(releaseService.compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
      expect(releaseService.compareVersions('v1.2.3', '1.2.3')).toBe(0);
      expect(releaseService.compareVersions('1.2.4', '1.2.3-beta')).toBeGreaterThan(0);
    });

    test('returns null on invalid semver', () => {
      expect(releaseService.compareVersions('invalid', '1.0.0')).toBeNull();
      expect(releaseService.compareVersions('1.0.0', 'unknown')).toBeNull();
    });
  });

  describe('checkForUpdate', () => {
    test('throws 400 for invalid platform', () => {
      expect(() => {
        releaseService.checkForUpdate({ platform: 'windows' });
      }).toThrow(/platform must be/);
    });

    test('detects up-to-date and older versions', () => {
      // Manifest currently has version 1.0.0 (or newer)
      const latest = releaseService.getLatest({ channel: 'production', platform: 'android' });
      if (!latest) return;

      const same = releaseService.checkForUpdate({
        platform: 'android',
        currentVersion: latest.version,
        currentBuild: latest.buildNumber,
      });
      expect(same.status).toBe('up-to-date');

      const older = releaseService.checkForUpdate({
        platform: 'android',
        currentVersion: '0.9.0',
        currentBuild: 1,
      });
      expect(['optional', 'critical', 'forced']).toContain(older.status);

      const olderBuild = releaseService.checkForUpdate({
        platform: 'android',
        currentVersion: latest.version,
        currentBuild: Math.max(0, Number(latest.buildNumber) - 1),
      });
      if (latest.buildNumber > 0) {
        expect(['optional', 'critical', 'forced']).toContain(olderBuild.status);
      }
    });
  });

  describe('normalizeManifest', () => {
    test('sanitizes and sorts releases by build number', () => {
      const raw = {
        updatedAt: '2026-11-02T00:00:00.000Z',
        releases: [
          {
            version: '1.0.0',
            buildNumber: 100,
            channel: 'production',
            artifacts: {
              android: {
                apkUrl: 'https://example.com/finpro-1.0.0.apk',
                sha256: 'a'.repeat(64),
                sizeBytes: 1000000,
              },
            },
          },
          {
            version: '1.1.0',
            buildNumber: 105,
            channel: 'production',
            critical: true,
            minimumSupportedVersion: '1.0.0',
            artifacts: {
              android: {
                apkUrl: 'https://example.com/finpro-1.1.0.apk',
                sha256: 'b'.repeat(64),
                sizeBytes: 1200000,
              },
            },
          },
        ],
      };

      const normalized = releaseService._normalizeManifest(raw);
      expect(normalized.releases).toHaveLength(2);
      expect(normalized.releases[0].version).toBe('1.1.0');
      expect(normalized.releases[0].critical).toBe(true);
      expect(normalized.releases[1].version).toBe('1.0.0');
    });

    test('rejects unsafe artifact URLs', () => {
      const raw = {
        releases: [
          {
            version: '1.0.0',
            buildNumber: 1,
            artifacts: {
              android: {
                apkUrl: 'javascript:alert(1)',
                sha256: 'c'.repeat(64),
              },
            },
          },
        ],
      };
      const normalized = releaseService._normalizeManifest(raw);
      expect(normalized.releases[0].artifacts.android.apkUrl).toBeUndefined();
    });
  });
});
