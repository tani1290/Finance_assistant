library;

/// Parsed release metadata returned by the public `/releases` API.
///
/// The backend sanitises the manifest before it reaches the client, but every
/// field is still validated here: the update flow downloads and installs an
/// artifact, so a malformed payload must never be acted on.

enum UpdateStatus { unavailable, upToDate, optional, critical, forced, error }

class ReleaseArtifact {
  const ReleaseArtifact({
    this.url,
    this.apkUrl,
    this.aabUrl,
    this.testflightUrl,
    this.appStoreUrl,
    this.sha256,
    this.sizeBytes,
    this.fileName,
  });

  final String? url;
  final String? apkUrl;
  final String? aabUrl;
  final String? testflightUrl;
  final String? appStoreUrl;
  final String? sha256;
  final int? sizeBytes;
  final String? fileName;

  /// The best installable location for a platform.
  ///
  /// Android prefers the APK (sideload/update path) and falls back to `url`.
  /// iOS has no sideloading: only TestFlight or the App Store are valid.
  String? downloadUrlForPlatform(String platform) {
    switch (platform) {
      case 'android':
        return apkUrl ?? url;
      case 'ios':
        return testflightUrl ?? appStoreUrl ?? url;
      default:
        return null;
    }
  }

  static ReleaseArtifact? fromJson(Object? json) {
    if (json is! Map) return null;
    String? readString(String key) {
      final value = json[key];
      if (value is! String) return null;
      final trimmed = value.trim();
      return trimmed.isEmpty ? null : trimmed;
    }

    final sha = readString('sha256');
    final size = json['sizeBytes'];
    final parsedSize = size is num ? size.toInt() : int.tryParse('$size');
    return ReleaseArtifact(
      url: readString('url'),
      apkUrl: readString('apkUrl'),
      aabUrl: readString('aabUrl'),
      testflightUrl: readString('testflightUrl'),
      appStoreUrl: readString('appStoreUrl'),
      sha256: sha != null && RegExp(r'^[a-fA-F0-9]{64}$').hasMatch(sha)
          ? sha.toLowerCase()
          : null,
      sizeBytes: parsedSize != null && parsedSize > 0 ? parsedSize : null,
      fileName: readString('fileName'),
    );
  }
}

class ReleaseInfo {
  const ReleaseInfo({
    required this.version,
    required this.buildNumber,
    required this.channel,
    this.releasedAt,
    this.critical = false,
    this.minimumSupportedVersion,
    this.minimumOs = const {},
    this.installNotes,
    this.releaseNotes = const [],
    this.artifacts = const {},
  });

  final String version;
  final int buildNumber;
  final String channel;
  final String? releasedAt;
  final bool critical;
  final String? minimumSupportedVersion;
  final Map<String, String> minimumOs;
  final String? installNotes;
  final List<String> releaseNotes;
  final Map<String, ReleaseArtifact> artifacts;

  ReleaseArtifact? artifactFor(String platform) => artifacts[platform];

  String? get displayDate {
    final raw = releasedAt;
    if (raw == null) return null;
    final parsed = DateTime.tryParse(raw);
    if (parsed == null) return raw;
    final local = parsed.toLocal();
    final month = local.month.toString().padLeft(2, '0');
    final day = local.day.toString().padLeft(2, '0');
    return '${local.year}-$month-$day';
  }

  static ReleaseInfo? fromJson(Object? json) {
    if (json is! Map) return null;
    final version = json['version'];
    if (version is! String || version.trim().isEmpty) return null;

    final buildRaw = json['buildNumber'];
    final build = buildRaw is num ? buildRaw.toInt() : int.tryParse('$buildRaw');

    final artifacts = <String, ReleaseArtifact>{};
    final rawArtifacts = json['artifacts'];
    if (rawArtifacts is Map) {
      for (final key in const ['android', 'ios']) {
        final artifact = ReleaseArtifact.fromJson(rawArtifacts[key]);
        if (artifact != null) artifacts[key] = artifact;
      }
    }

    final notes = <String>[];
    final rawNotes = json['releaseNotes'];
    if (rawNotes is List) {
      for (final note in rawNotes) {
        if (note is String && note.trim().isNotEmpty) notes.add(note.trim());
      }
    }

    final minimumOs = <String, String>{};
    final rawMinimumOs = json['minimumOs'];
    if (rawMinimumOs is Map) {
      rawMinimumOs.forEach((key, value) {
        if (key is String && value is String && value.trim().isNotEmpty) {
          minimumOs[key] = value.trim();
        }
      });
    }

    return ReleaseInfo(
      version: version.trim(),
      buildNumber: build ?? 0,
      channel: json['channel'] is String
          ? (json['channel'] as String).trim()
          : 'production',
      releasedAt: json['releasedAt'] is String
          ? json['releasedAt'] as String
          : null,
      critical: json['critical'] == true,
      minimumSupportedVersion: json['minimumSupportedVersion'] is String
          ? (json['minimumSupportedVersion'] as String).trim()
          : null,
      minimumOs: minimumOs,
      installNotes: json['installNotes'] is String
          ? (json['installNotes'] as String).trim()
          : null,
      releaseNotes: notes,
      artifacts: artifacts,
    );
  }
}

class UpdateCheckResult {
  const UpdateCheckResult({
    required this.status,
    required this.platform,
    required this.currentVersion,
    required this.currentBuild,
    this.latest,
    this.previous = const [],
    this.errorMessage,
  });

  final UpdateStatus status;
  final String platform;
  final String currentVersion;
  final int currentBuild;
  final ReleaseInfo? latest;
  final List<ReleaseInfo> previous;
  final String? errorMessage;

  bool get hasUpdate =>
      status == UpdateStatus.optional ||
      status == UpdateStatus.critical ||
      status == UpdateStatus.forced;

  /// Only a forced update blocks the app; critical updates can be postponed.
  bool get blocksUsage => status == UpdateStatus.forced;

  static UpdateCheckResult failure({
    required String platform,
    required String currentVersion,
    required int currentBuild,
    required String message,
  }) {
    return UpdateCheckResult(
      status: UpdateStatus.error,
      platform: platform,
      currentVersion: currentVersion,
      currentBuild: currentBuild,
      errorMessage: message,
    );
  }

  static UpdateCheckResult fromJson(
    Map<String, dynamic> json, {
    required String platform,
    required String currentVersion,
    required int currentBuild,
  }) {
    final statusName = json['status'] is String ? json['status'] as String : '';
    final status = switch (statusName) {
      'up-to-date' => UpdateStatus.upToDate,
      'optional' => UpdateStatus.optional,
      'critical' => UpdateStatus.critical,
      'forced' => UpdateStatus.forced,
      _ => UpdateStatus.unavailable,
    };

    final previous = <ReleaseInfo>[];
    final rawPrevious = json['previous'];
    if (rawPrevious is List) {
      for (final entry in rawPrevious) {
        final parsed = ReleaseInfo.fromJson(entry);
        if (parsed != null) previous.add(parsed);
      }
    }

    return UpdateCheckResult(
      status: status,
      platform: platform,
      currentVersion: currentVersion,
      currentBuild: currentBuild,
      latest: ReleaseInfo.fromJson(json['latest']),
      previous: previous,
    );
  }
}
