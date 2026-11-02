#!/usr/bin/env node
/**
 * Add or replace one release entry in the public release manifest.
 *
 * The release workflow calls this only after the APK/AAB have been built,
 * signed and checksum-verified. Keeping manifest generation in its own script
 * means a failed build can never leave a half-written "latest" entry behind:
 * the workflow writes the file and only then publishes.
 *
 * Usage (all paths relative to the repository root):
 *   node scripts/release/update-manifest.js \
 *     --version 1.2.0 --build 1042 --channel production \
 *     --apk build/app/outputs/flutter-apk/app-release.apk \
 *     --aab build/app/outputs/bundle/release/app-release.aab \
 *     --apk-url https://github.com/org/repo/releases/download/v1.2.0/finpro-1.2.0.apk \
 *     --aab-url https://github.com/org/repo/releases/download/v1.2.0/finpro-1.2.0.aab \
 *     --notes-file release-notes.md \
 *     --critical false --minimum-supported 1.0.0 \
 *     --min-android 8.0 --min-ios 15.0 \
 *     --manifest frontend/public/releases/manifest.json
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true';
    args[key] = value;
    if (value !== 'true') i += 1;
  }
  return args;
}

function fail(message) {
  console.error(`[release-manifest] ${message}`);
  process.exit(1);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function atomicWrite(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, contents);
  fs.renameSync(temp, file);
}

function parseNotes(value, notesFile) {
  if (notesFile && fs.existsSync(notesFile)) {
    return fs
      .readFileSync(notesFile, 'utf8')
      .split('\n')
      .map((line) => line.replace(/^[-*]\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 100);
  }
  if (!value) return [];
  return value
    .split(/\r?\n|\|\|/)
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 100);
}

function normalizeUrl(value, label) {
  if (!value) return undefined;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') fail(`${label} must be an HTTPS URL (got ${parsed.protocol})`);
    return parsed.toString();
  } catch {
    fail(`${label} is not a valid URL: ${value}`);
  }
}

const args = parseArgs(process.argv.slice(2));
const version = args.version;
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) fail('--version must be semver, e.g. 1.2.0');

const build = Number(args.build);
if (!Number.isInteger(build) || build <= 0) fail('--build must be a positive integer');

const channel = (args.channel || 'production').toLowerCase();
const manifestPath = path.resolve(args.manifest || 'frontend/public/releases/manifest.json');

let manifest = { schemaVersion: 1, updatedAt: null, releases: [] };
if (fs.existsSync(manifestPath)) {
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail(`existing manifest is not valid JSON: ${error.message}`);
  }
}
if (!Array.isArray(manifest.releases)) manifest.releases = [];

const artifacts = {};

if (args.apk) {
  if (!fs.existsSync(args.apk)) fail(`APK not found: ${args.apk}`);
  const apkUrl = normalizeUrl(args['apk-url'], '--apk-url');
  if (!apkUrl) fail('--apk-url is required when --apk is supplied');
  artifacts.android = {
    apkUrl,
    sha256: sha256(args.apk),
    sizeBytes: fs.statSync(args.apk).size,
    fileName: path.basename(args.apk),
  };
}

if (args.aab) {
  if (!fs.existsSync(args.aab)) fail(`AAB not found: ${args.aab}`);
  const aabUrl = normalizeUrl(args['aab-url'], '--aab-url');
  if (artifacts.android) {
    if (aabUrl) artifacts.android.aabUrl = aabUrl;
    artifacts.android.aabSha256 = sha256(args.aab);
  }
}

if (args['testflight-url'] || args['appstore-url'] || args.ipa) {
  artifacts.ios = {};
  const testflight = normalizeUrl(args['testflight-url'], '--testflight-url');
  const appstore = normalizeUrl(args['appstore-url'], '--appstore-url');
  if (testflight) artifacts.ios.testflightUrl = testflight;
  if (appstore) artifacts.ios.appStoreUrl = appstore;
  if (args.ipa && fs.existsSync(args.ipa)) {
    artifacts.ios.sha256 = sha256(args.ipa);
    artifacts.ios.sizeBytes = fs.statSync(args.ipa).size;
    artifacts.ios.fileName = path.basename(args.ipa);
  }
}

if (Object.keys(artifacts).length === 0) fail('no artifacts were supplied; refusing to publish an empty release');

const entry = {
  version,
  buildNumber: build,
  channel,
  releasedAt: new Date().toISOString(),
  published: true,
  critical: String(args.critical).toLowerCase() === 'true',
  minimumSupportedVersion: args['minimum-supported'] || version,
  minimumOs: {
    ...(args['min-android'] ? { android: args['min-android'] } : {}),
    ...(args['min-ios'] ? { ios: args['min-ios'] } : {}),
  },
  installNotes: args['install-notes'] || null,
  releaseNotes: parseNotes(args.notes, args['notes-file']),
  artifacts,
};

// Replace an existing entry for the same channel/version/build, then sort so
// the newest build is always first. Never delete older entries: the download
// centre must keep offering previous versions.
manifest.releases = [entry, ...manifest.releases.filter((r) => !(
  r && r.version === version && Number(r.buildNumber) === build && r.channel === channel
))].sort((a, b) => Number(b.buildNumber) - Number(a.buildNumber));

manifest.schemaVersion = 1;
manifest.updatedAt = new Date().toISOString();

atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[release-manifest] wrote ${manifestPath}`);
console.log(JSON.stringify(entry, null, 2));
