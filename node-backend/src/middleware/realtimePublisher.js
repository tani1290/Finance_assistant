/**
 * FinPro — Generic Realtime Publisher
 *
 * Blanket safety-net: any successful mutation under /api/v1 automatically
 * emits a `sync.changed` event to the acting user's devices. Rich, typed
 * events (transaction.created, sms.confirmed, ai.action, …) are published
 * explicitly by the controllers that own those flows — this middleware only
 * guarantees nothing is ever silently un-synced.
 *
 * Runs on `res.on('finish')` so it never adds latency to the request.
 */

'use strict';

const realtime = require('../services/realtimeService');

const METHOD_ACTION = {
  POST: 'created',
  PATCH: 'updated',
  PUT: 'updated',
  DELETE: 'deleted',
};

const PATH_ACTIONS = [
  [/\/confirm$/, 'confirmed'],
  [/\/reject$/, 'rejected'],
  [/\/contribute$/, 'contributed'],
  [/\/deposit$/, 'deposited'],
  [/\/withdraw$/, 'withdrawn'],
  [/\/ingest$/, 'ingested'],
  [/\/register$/, 'registered'],
  [/\/read-all$/, 'read'],
  [/\/accept$/, 'accepted'],
  [/\/complete$/, 'completed'],
  [/\/archive$/, 'archived'],
  [/\/pay$/, 'paid'],
];

/** Derive { resource, action, id } from a full request path. Returns null for non-domain paths. */
function classifyPath(fullPath, method) {
  const match = fullPath.match(/^\/api\/v1\/([a-z0-9-]+)/i);
  if (!match) return null;

  const resource = match[1];
  let action = METHOD_ACTION[method] || 'changed';

  const lower = fullPath.toLowerCase();
  for (const [re, name] of PATH_ACTIONS) {
    if (re.test(lower)) {
      action = name;
      break;
    }
  }

  // The trailing path segment is usually the record id.
  const segments = fullPath.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  const id = last && /^[0-9a-zA-Z_-]{6,}$/.test(last) && !PATH_ACTIONS.some(([re]) => re.test('/' + last))
    ? last
    : undefined;

  return { resource, action, id };
}

function realtimePublisher(req, res, next) {
  if (req.method === 'GET' || req.method === 'OPTIONS') return next();

  // Capture the ORIGINAL path NOW, not inside the finish callback. Once a
  // mounted child router has handled the request it restores/rewrites
  // `req.url`, so `req.path` read at `finish` time can collapse to the
  // router-relative '/sms/ingest' — which fails the '/api/v1/' guard below and
  // silently disables the entire sync safety net. `req.originalUrl` is never
  // rewritten.
  const fullPath = (req.originalUrl || req.url || '').split('?')[0];

  if (!fullPath.startsWith('/api/v1/')) return next();
  // Never echo realtime/auth traffic back into the stream.
  if (fullPath.startsWith('/api/v1/realtime')) return next();
  if (fullPath.startsWith('/api/v1/auth')) return next();

  res.on('finish', () => {
    try {
      if (!req.user || !req.user.id) return;
      if (res.statusCode < 200 || res.statusCode >= 300) return;

      const info = classifyPath(fullPath, req.method);
      if (!info) return;

      realtime.publish(
        req.user.id,
        'sync.changed',
        {
          resource: info.resource,
          action: info.action,
          id: info.id,
          method: req.method,
          path: fullPath,
        },
        { source: req.headers['x-client'] || 'server' }
      );
    } catch {
      /* a publish failure must never surface to the client */
    }
  });

  return next();
}

module.exports = realtimePublisher;
