/**
 * FinPro — Realtime Controller
 *
 * Transport for cross-device sync:
 *   GET /api/v1/realtime/stream   → Server-Sent Events (primary)
 *   GET /api/v1/realtime/changes  → watermark delta (polling fallback)
 *
 * Auth accepts `?token=` (see middleware/auth), which is required because the
 * browser EventSource API cannot set an Authorization header.
 */

'use strict';

const realtime = require('../services/realtimeService');

/**
 * SSE stream. Holds the connection open, pushes `sync.*` domain events, and
 * replays anything missed while the client was offline via Last-Event-ID.
 */
exports.stream = (req, res) => {
  const userId = req.user.id;

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    // no-transform explicitly opts this stream out of the compression
    // middleware, which would otherwise buffer the frames.
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  // Ask EventSource to reconnect after 3s instead of the browser default.
  res.write('retry: 3000\n\n');

  const client = realtime.addClient(userId, res, {
    ua: req.headers['user-agent'] || '',
    ip: req.ip,
  });

  // Handshake: tell the client which watermark it currently sits at, so the
  // client can pick the right resume point if it falls back to polling.
  try {
    res.write(
      `event: hello\ndata: ${JSON.stringify({
        seq: realtime.currentSeq(userId),
        heartbeatMs: realtime.HEARTBEAT_MS,
        at: new Date().toISOString(),
      })}\n\n`
    );
  } catch {
    /* socket vanished */
  }

  // Replay missed events (server restart, network blip, laptop sleep).
  const resumeFrom = Number(
    req.headers['last-event-id'] || req.query.lastEventId || 0
  );
  if (Number.isFinite(resumeFrom) && resumeFrom > 0) {
    const { events } = realtime.changesSince(userId, resumeFrom);
    for (const event of events) {
      try {
        res.write(realtime.serialize(event));
      } catch {
        break;
      }
    }
  }

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    realtime.removeClient(client);
  };

  req.on('close', cleanup);
  req.on('aborted', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
};

/**
 * Polling fallback / watermark delta.
 * GET /api/v1/realtime/changes?since=<seq>
 */
exports.changes = (req, res) => {
  const { events, seq } = realtime.changesSince(req.user.id, req.query.since);
  res.json({
    success: true,
    data: {
      seq,
      count: events.length,
      events,
      serverTime: new Date().toISOString(),
    },
  });
};

/**
 * Lightweight liveness probe for the sync indicator.
 * GET /api/v1/realtime/status
 */
exports.status = (req, res) => {
  res.json({
    success: true,
    data: {
      seq: realtime.currentSeq(req.user.id),
      serverTime: new Date().toISOString(),
      transport: 'sse',
      ...realtime.stats(),
    },
  });
};
