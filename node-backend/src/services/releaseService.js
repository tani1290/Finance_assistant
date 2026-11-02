/**
 * Release metadata service.
 *
 * A single JSON manifest is the source of truth for the public download centre
 * and the in-app update check. The manifest contains *no* secrets: only version
 * numbers, public HTTPS (or same-origin relative) artifact URLs, checksums,
 * release notes and minimum-OS metadata.
 *
 * The file is written by the release workflow after a successful, verified
 * build. A failed build must never update it — the workflow only publishes the
 * manifest as the last step, so a broken artifact cannot become "latest".
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MANIFEST_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'frontend',
  'public',
  'releases',
  'manifest.json'
);

const MANIFEST_PATH = process.env.RELEASE_MANIFEST_PATH
  ? path.resolve(process.env.RELEASE_MANIFEST_PATH)
  : DEFAULT_MANIFEST_PATH;

const CACHE_TTL_MS = 30 * 1000;
let cache = { mtimeMs: 0, loadedAt: 0, manifest: null };

function emptyManifest() {
  return {
    schemaVersion: 1,
    updatedAt: null,
    releases: [],
  };
}

function readManifest() {
  let stat;
  try {
    stat = fs.statSync(MANIFEST_PATH);
  } catch (error) {
    if (error.code === 'ENOENT') return emptyManifest();
    throw error;
  }

  const now = Date.now();
  if (cache.manifest && cache.mtimeMs === stat.mtimeMs && now - cache.loadedAt < CACHE_TTL_MS) {
    return cache.manifest;
  }

  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const manifest = normalizeManifest(parsed);
  cache = { mtimeMs: stat.mtimeMs, loadedAt: now, manifest };
  return manifest;
}

function isSafeUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const url = value.trim();
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function sanitizeArtifact(artifact) {
  if (!artifact || typeof artifact !== 'object') return null;
  const out = {};
  if (isSafeUrl(artifact.url)) out.url = artifact.url.trim();
  if (isSafeUrl(artifact.apkUrl)) out.apkUrl = artifact.apkUrl.trim();
  if (isSafeUrl(artifact.aabUrl)) out.aabUrl = artifact.aabUrl.trim();
  if (isSafeUrl(artifact.testflightUrl)) out.testflightUrl = artifact.testflightUrl.trim();
  if (isSafeUrl(artifact.appStoreUrl)) out.appStoreUrl = artifact.appStoreUrl.trim();
  if (typeof artifact.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(artifact.sha256)) {
    out.sha256 = artifact.sha256.toLowerCase();
  }
  if (Number.isFinite(Number(artifact.sizeBytes)) && Number(artifact.sizeBytes) > 0) {
    out.sizeBytes = Number(artifact.sizeBytes);
  }
  if (typeof artifact.fileName === 'string' && artifact.fileName.trim()) {
    out.fileName = artifact.fileName.trim().slice(0, 200);
  }
  return Object.keys(out).length > 0 ? out : null;
}

function sanitizePlatform(value) {
  if (!value || typeof value !== 'object') return null;
  const out = {};
  for (const key of ['android', 'ios']) {
    if (typeof value[key] === 'string' && value[key].trim()) {
      out[key] = value[key].trim().slice(0, 40);
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function sanitizeRelease(release) {
  if (!release || typeof release !== 'object') return null;
  if (typeof release.version !== 'string' || !release.version.trim()) return null;

  const buildNumber = Number(release.buildNumber);
  const channel = typeof release.channel === 'string' ? release.channel.trim().toLowerCase() : 'production';
  const notes = Array.isArray(release.releaseNotes)
    ? release.releaseNotes.filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim().slice(0, 500)).slice(0, 100)
    : [];

  const artifacts = {};
  const rawArtifacts = release.artifacts && typeof release.artifacts === 'object' ? release.artifacts : {};
  for (const platform of ['android', 'ios']) {
    const clean = sanitizeArtifact(rawArtifacts[platform]);
    if (clean) artifacts[platform] = clean;
  }

  return {
    version: release.version.trim().slice(0, 40),
    buildNumber: Number.isFinite(buildNumber) ? buildNumber : 0,
    channel,
    releasedAt: typeof release.releasedAt === 'string' ? release.releasedAt : null,
    published: release.published !== false,
    critical: release.critical === true,
    minimumSupportedVersion:
      typeof release.minimumSupportedVersion === 'string' ? release.minimumSupportedVersion.trim() : null,
    minimumOs: sanitizePlatform(release.minimumOs) || {},
    installNotes:
      typeof release.installNotes === 'string' ? release.installNotes.trim().slice(0, 2000) : null,
    releaseNotes: notes,
    artifacts,
  };
}

function normalizeManifest(parsed) {
  const releases = Array.isArray(parsed && parsed.releases) ? parsed.releases : [];

  const cleaned = releases
    .map(sanitizeRelease)
    .filter(Boolean)
    // Newest first: build number is monotonic, version is the human fallback.
    .sort((a, b) => b.buildNumber - a.buildNumber || compareVersions(b.version, a.version));

  return {
    schemaVersion: 1,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    releases: cleaned,
  };
}

function parseVersion(version) {
  const match = String(version || '')
    .trim()
    .match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/i);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Returns <0, 0, >0, or null when either side is not semver. */
function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

function isNewer(candidate, current) {
  if (!candidate) return false;
  if (!current) return true;
  const byVersion = compareVersions(candidate.version, current.version);
  if (byVersion !== null && byVersion !== 0) return byVersion > 0;
  // Identical or unparseable versions fall back to the monotonic build number.
  return Number(candidate.buildNumber) > Number(current.buildNumber || 0);
}

function publicRelease(release) {
  return {
    version: release.version,
    buildNumber: release.buildNumber,
    channel: release.channel,
    releasedAt: release.releasedAt,
    critical: release.critical,
    minimumSupportedVersion: release.minimumSupportedVersion,
    minimumOs: release.minimumOs,
    installNotes: release.installNotes,
    releaseNotes: release.releaseNotes,
    artifacts: release.artifacts,
  };
}

function listReleases({ channel = 'production', platform = null } = {}) {
  const manifest = readManifest();
  return manifest.releases
    .filter((release) => release.published && release.channel === channel)
    .filter((release) => (platform ? Boolean(release.artifacts[platform]) : true));
}

function getLatest({ channel = 'production', platform = null } = {}) {
  return listReleases({ channel, platform })[0] || null;
}

function getRelease(version, { channel = 'production' } = {}) {
  const manifest = readManifest();
  return (
    manifest.releases.find(
      (release) => release.published && release.channel === channel && release.version === version
    ) || null
  );
}

/**
 * Update decision. `forced` means the installed version is below the release's
 * declared minimum-supported version; `critical` is a strongly recommended
 * update that the user can still postpone.
 */
function checkForUpdate({ platform, currentVersion, currentBuild, channel = 'production' } = {}) {
  if (!platform || !['android', 'ios'].includes(platform)) {
    const error = new Error("platform must be 'android' or 'ios'");
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const releases = listReleases({ channel, platform });
  const latest = releases[0] || null;
  if (!latest) {
    return {
      status: 'unavailable',
      platform,
      channel,
      currentVersion: currentVersion || null,
      latest: null,
    };
  }

  const current = {
    version: currentVersion || null,
    buildNumber: Number.isFinite(Number(currentBuild)) ? Number(currentBuild) : 0,
  };

  const minimum = latest.minimumSupportedVersion;
  const belowMinimum = minimum ? compareVersions(current.version, minimum) : null;
  const forced = current.version ? belowMinimum !== null && belowMinimum < 0 : false;

  let status = 'up-to-date';
  if (isNewer(latest, current)) {
    status = forced ? 'forced' : latest.critical ? 'critical' : 'optional';
  }

  return {
    status,
    platform,
    channel,
    currentVersion: current.version,
    currentBuild: current.buildNumber,
    latest: publicRelease(latest),
    // Previous releases the user can still download/roll back to.
    previous: releases.slice(1, 6).map(publicRelease),
  };
}

function getManifestSummary() {
  const manifest = readManifest();
  const production = manifest.releases.filter((r) => r.published && r.channel === 'production');
  return {
    schemaVersion: manifest.schemaVersion,
    updatedAt: manifest.updatedAt,
    count: production.length,
    latest: production[0] ? publicRelease(production[0]) : null,
    releases: production.map(publicRelease),
  };
}

module.exports = {
  MANIFEST_PATH,
  compareVersions,
  listReleases,
  getLatest,
  getRelease,
  checkForUpdate,
  getManifestSummary,
  publicRelease,
  _normalizeManifest: normalizeManifest,
};
