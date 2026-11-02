/**
 * Public release metadata controller.
 *
 * No authentication: the download centre and the app's launch-time update
 * check must work before sign-in. The responses are strictly public metadata —
 * never artifact credentials, signing material or user data.
 */

'use strict';

const releaseService = require('../services/releaseService');

function handle(res, error, fallbackMessage) {
  const statusCode = error && error.statusCode ? error.statusCode : 500;
  if (statusCode >= 500) console.error('[Releases] Unhandled error:', error);
  return res.status(statusCode).json({
    success: false,
    error: (error && error.code) || 'SERVER_ERROR',
    message: error && error.message ? error.message : fallbackMessage,
  });
}

exports.getReleases = async (req, res) => {
  try {
    const channel = typeof req.query.channel === 'string' ? req.query.channel.toLowerCase() : 'production';
    const platform = typeof req.query.platform === 'string' ? req.query.platform.toLowerCase() : null;
    if (platform && !['android', 'ios'].includes(platform)) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: "platform must be 'android' or 'ios'",
      });
    }

    const releases = releaseService.listReleases({ channel, platform }).map(releaseService.publicRelease);
    return res.status(200).json({
      success: true,
      data: {
        channel,
        platform,
        count: releases.length,
        latest: releases[0] || null,
        releases,
      },
    });
  } catch (error) {
    return handle(res, error, 'Failed to read releases');
  }
};

exports.getLatest = async (req, res) => {
  try {
    const channel = typeof req.query.channel === 'string' ? req.query.channel.toLowerCase() : 'production';
    const platform = typeof req.query.platform === 'string' ? req.query.platform.toLowerCase() : null;
    if (platform && !['android', 'ios'].includes(platform)) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: "platform must be 'android' or 'ios'",
      });
    }

    const latest = releaseService.getLatest({ channel, platform });
    if (!latest) {
      return res.status(404).json({
        success: false,
        error: 'NO_RELEASE',
        message: 'No published release is available for this platform yet.',
      });
    }

    return res.status(200).json({
      success: true,
      data: releaseService.publicRelease(latest),
    });
  } catch (error) {
    return handle(res, error, 'Failed to read latest release');
  }
};

exports.checkForUpdate = async (req, res) => {
  try {
    const platform = typeof req.query.platform === 'string' ? req.query.platform.toLowerCase() : null;
    const data = releaseService.checkForUpdate({
      platform,
      currentVersion: typeof req.query.version === 'string' ? req.query.version : null,
      currentBuild: req.query.build,
      channel: typeof req.query.channel === 'string' ? req.query.channel.toLowerCase() : 'production',
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handle(res, error, 'Failed to check for updates');
  }
};

exports.getRelease = async (req, res) => {
  try {
    const channel = typeof req.query.channel === 'string' ? req.query.channel.toLowerCase() : 'production';
    const release = releaseService.getRelease(req.params.version, { channel });
    if (!release) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Release not found',
      });
    }
    return res.status(200).json({ success: true, data: releaseService.publicRelease(release) });
  } catch (error) {
    return handle(res, error, 'Failed to read release');
  }
};

exports.getSummary = async (req, res) => {
  try {
    return res.status(200).json({ success: true, data: releaseService.getManifestSummary() });
  } catch (error) {
    return handle(res, error, 'Failed to read release manifest');
  }
};
