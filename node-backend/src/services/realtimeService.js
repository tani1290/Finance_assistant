/**
 * FinPro — Realtime Sync Service (SSE + polling watermark)
 *
 * Keeps every open tab / device of a user in lock-step with the server.
 *
 * Design:
 *  - A per-user registry of open Server-Sent-Events connections.
 *  - A bounded, sequenced per-user event log so a reconnecting client can
 *    replay what it missed via `Last-Event-ID` (and so the polling fallback
 *    can return a delta instead of a full refetch).
 *
 * Zero external dependencies — pure Node http primitives on top of Express.
 */

'use strict';

const HEARTBEAT_MS = 25_000;   // keep-alive comment cadence
const LOG_LIMIT = 200;         // per-user bounded replay buffer

/** @type {Map<string, Set<object>>} userId -> Set<clientHandle> */
const clients = new Map();
/** @type {Map<string, {seq:number, events:Array}>} userId -> event log */
const logs = new Map();

let clientIdCounter = 0;
let heartbeatTimer = null;

function logFor(userId) {
  let log = logs.get(userId);
  if (!log) {
    log = { seq: 0, events: [] };
    logs.set(userId, log);
  }
  return log;
}

/** Current sequence number for a user (0 when nothing has happened yet). */
function currentSeq(userId) {
  const log = logs.get(userId);
  return log ? log.seq : 0;
}

/** Serialize an event into an SSE frame (id + named event + JSON data). */
function serialize(event) {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Publish a domain event to every open connection of a user.
 * Never throws — a dropped socket must not break the request that produced it.
 *
 * @param {string} userId
 * @param {string} type    dotted event name, e.g. "transaction.created"
 * @param {object} [data]  small JSON payload for the client
 * @param {object} [meta]  { source: 'web'|'mobile'|'ai'|'server' }
 * @returns {object|null}  the stored event
 */
function publish(userId, type, data = {}, meta = {}) {
  if (!userId || !type) return null;

  const log = logFor(userId);
  log.seq += 1;

  const event = {
    id: log.seq,
    type,
    at: new Date().toISOString(),
    source: (meta && meta.source) || 'server',
    data: data || {},
  };

  log.events.push(event);
  if (log.events.length > LOG_LIMIT) {
    log.events.splice(0, log.events.length - LOG_LIMIT);
  }

  const frame = serialize(event);
  const set = clients.get(userId);
  if (set) {
    for (const client of set) {
      try {
        client.res.write(frame);
      } catch {
        // Socket already gone — it will be cleaned up on 'close'.
      }
    }
  }

  return event;
}

/** Register an open SSE response stream for a user. */
function addClient(userId, res, meta = {}) {
  const client = {
    id: ++clientIdCounter,
    userId,
    res,
    meta,
    openedAt: Date.now(),
  };
  let set = clients.get(userId);
  if (!set) {
    set = new Set();
    clients.set(userId, set);
  }
  set.add(client);
  ensureHeartbeat();
  return client;
}

/** Remove a closed SSE stream. */
function removeClient(client) {
  if (!client) return;
  const set = clients.get(client.userId);
  if (!set) return;
  set.delete(client);
  if (set.size === 0) clients.delete(client.userId);
  if (countConnections() === 0) stopHeartbeat();
}

/** Return events newer than `since` (used by both SSE resume and polling). */
function changesSince(userId, since) {
  const log = logFor(userId);
  const sinceNum = Number.isFinite(Number(since)) ? Number(since) : 0;
  return {
    seq: log.seq,
    events: log.events.filter((e) => e.id > sinceNum),
  };
}

function countConnections() {
  let total = 0;
  for (const set of clients.values()) total += set.size;
  return total;
}

function stats() {
  return {
    users: clients.size,
    connections: countConnections(),
    trackedUsers: logs.size,
  };
}

/** Force-close every connection (used on graceful shutdown). */
function closeAll() {
  for (const set of clients.values()) {
    for (const client of set) {
      try {
        client.res.end();
      } catch {
        /* ignore */
      }
    }
  }
  clients.clear();
  stopHeartbeat();
}

function ensureHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    const beat = `: heartbeat ${Date.now()}\n\n`;
    for (const set of clients.values()) {
      for (const client of set) {
        try {
          client.res.write(beat);
        } catch {
          /* cleaned up on close */
        }
      }
    }
  }, HEARTBEAT_MS);
  if (heartbeatTimer.unref) heartbeatTimer.unref();
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

module.exports = {
  publish,
  addClient,
  removeClient,
  changesSince,
  currentSeq,
  serialize,
  stats,
  closeAll,
  HEARTBEAT_MS,
};
