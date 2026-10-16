/**
 * FinPro — Realtime Sync Client (cross-device, ACID-aware)
 * FinPro — Personal Finance & Investment Decision Support Platform
 *
 * Keeps every open tab and every device of a signed-in user in lock-step with
 * the backend ledger.
 *
 * Transport
 *   Primary  → Server-Sent Events  GET /api/v1/realtime/stream?token=…
 *   Fallback → watermark polling   GET /api/v1/realtime/changes?since=…
 *
 * The backend publishes `sync.changed` for *every* successful mutation (plus
 * rich typed events like `sms.pending` / `transaction.created` / `ai.action`).
 * `sync.changed` is therefore the universal safety net: nothing can ever be
 * silently un-synced, while typed events are used to enrich the experience
 * (cross-device chime, targeted reload).
 *
 * Loaded as a classic script (like sidebar.js) so that plain <script> pages and
 * <script type="module"> pages can both use `window.finproRealtime`.
 *
 * Owner: Jinay Golecha (jinay_golecha)
 */

(function () {
  'use strict';

  if (window.finproRealtime) return; // already installed

  // ---------------------------------------------------------------- constants

  var isLocal =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';

  var API_BASE =
    !isLocal || window.location.origin.indexOf(':5001') !== -1
      ? '/api/v1'
      : 'http://127.0.0.1:5001/api/v1';

  var POLL_MS = 5000;          // polling cadence while in fallback mode
  var BACKOFF_BASE_MS = 1000;  // first reconnect delay
  var BACKOFF_MAX_MS = 20000;  // reconnect ceiling
  var POLL_AFTER_FAILURES = 3; // switch to polling after N failed connects
  var DEDUPE_LIMIT = 500;      // remembered event ids (avoids replay double-apply)
  var LOG_LIMIT = 200;         // matches realtimeService.LOG_LIMIT
  var CHANGE_DEBOUNCE_MS = 350;

  // Tab-scoped identity. Stamped onto every API request as `X-Client`, which
  // the backend echoes back as `event.source` — that is how this tab recognises
  // its own mutations and stays quiet while other devices still chime.
  var clientId;
  try {
    clientId = sessionStorage.getItem('jf_client_id');
    if (!clientId) {
      clientId =
        Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      sessionStorage.setItem('jf_client_id', clientId);
    }
  } catch (_) {
    clientId = 'anon' + Math.random().toString(36).slice(2, 8);
  }
  var SELF_ID = 'web:' + clientId;

  // Typed events that should reach the user even when they are on another page
  // or another device. `sync.changed` (the catch-all) never notifies on its own.
  var NOTIFY_TYPES = {
    'sms.pending': function (d) {
      if (d && d.count) {
        return {
          title: 'New SMS transactions',
          message: d.count + ' transactions detected on your phone',
        };
      }
      return {
        title: 'New SMS transaction',
        message:
          '₹' + fmtMoney(d && d.amount) +
          (d && d.merchant ? ' · ' + d.merchant : '') +
          ' — review now',
      };
    },
    'transaction.created': function (d) {
      return {
        title: 'Transaction recorded',
        message:
          '₹' + fmtMoney(d && d.amount) +
          (d && d.description ? ' · ' + d.description : ''),
      };
    },
    'sms.confirmed': function () {
      return {
        title: 'SMS transaction confirmed',
        message: 'A pending SMS was confirmed on another device',
      };
    },
    'sms.rejected': function () {
      return {
        title: 'SMS transaction dismissed',
        message: 'A pending SMS was rejected on another device',
      };
    },
  };

  // Singular resource → the plural key the pages register against.
  var RESOURCE_ALIAS = {
    account: 'accounts',
    transaction: 'transactions',
    budget: 'budgets',
    goal: 'goals',
    investment: 'investments',
    portfolio: 'investments',
    loan: 'loans',
    insurance: 'insurance',
    subscription: 'subscriptions',
    card: 'cards',
    task: 'tasks',
    notification: 'notifications',
    sms: 'sms',
    ai: 'ai',
    calendar: 'calendar',
    profile: 'profile',
  };

  // ----------------------------------------------------------------- helpers

  function getToken() {
    try {
      return localStorage.getItem('jf_access_token');
    } catch (_) {
      return null;
    }
  }

  function fmtMoney(v) {
    var n = Number(v);
    if (!isFinite(n)) return '0';
    return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  function ago(ms) {
    if (!ms) return 'never';
    var s = Math.max(1, Math.round((Date.now() - ms) / 1000));
    if (s < 5) return 'just now';
    if (s < 60) return s + 's ago';
    var m = Math.round(s / 60);
    if (m < 60) return m + 'm ago';
    return Math.round(m / 60) + 'h ago';
  }

  function safeStorageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function safeStorageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_) {}
  }

  // ------------------------------------------------------------------ state

  var listeners = {};          // eventType -> [fn]
  var anyListeners = [];       // fn[]
  var notifyListeners = [];    // fn(notice, event)
  var changeSubs = [];         // { resources: Set|null, reload, timer, dirty }
  var appliedIds = [];         // ring buffer of applied event ids
  var appliedSet = {};
  var es = null;               // active EventSource
  var pollTimer = null;
  var reconnectTimer = null;
  var indicatorTimer = null;
  var failures = 0;            // consecutive connection failures
  var started = false;
  var stopped = false;
  var stateName = 'idle';      // idle | connecting | live | polling | offline
  var transport = 'sse';
  var lastSeq = Number(safeStorageGet('jf_realtime_seq') || 0) || 0;
  var lastSyncAt = 0;
  var indicator = null;
  var indicatorText = null;
  var indicatorDot = null;

  // ------------------------------------------------------------------- fetch

  // Stamp every backend call with this tab's identity so the events we caused
  // ourselves can be told apart from another device's (or another tab's).
  (function patchFetch() {
    if (typeof window.fetch !== 'function') return;
    var orig = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        var url =
          typeof input === 'string'
            ? input
            : input && typeof input.url === 'string'
            ? input.url
            : '';
        if (url.indexOf('/api/') !== -1 && url.indexOf('/api/v1/realtime') === -1) {
          var headers = new Headers(
            (init && init.headers) || (input && input.headers) || undefined
          );
          if (!headers.has('X-Client')) headers.set('X-Client', SELF_ID);
          init = Object.assign({}, init || {}, { headers: headers });
        }
      } catch (_) {
        /* never let instrumentation break a request */
      }
      return orig(input, init);
    };
  })();

  // ----------------------------------------------------------- event plumbing

  function markApplied(id) {
    if (appliedSet[id]) return true;
    appliedIds.push(id);
    appliedSet[id] = true;
    if (appliedIds.length > DEDUPE_LIMIT) {
      delete appliedSet[appliedIds.shift()];
    }
    return false;
  }

  function emit(type, fn, ev) {
    try {
      fn(ev);
    } catch (err) {
      if (window.console) console.warn('[realtime] listener error', type, err);
    }
  }

  /** Derive the plural resource key an event touches (for page subscriptions). */
  function resourceOf(ev) {
    var t = ev && ev.type;
    if (!t) return null;

    if (t === 'sync.changed') {
      var r = ev.data && ev.data.resource;
      return r || null;
    }
    if (t.indexOf('.changed') === t.length - 8) {
      var singular = t.slice(0, t.length - 8);
      return RESOURCE_ALIAS[singular] || singular;
    }
    if (t === 'transaction.created') return 'transactions';
    if (t === 'sms.pending' || t === 'sms.confirmed' || t === 'sms.rejected') {
      return 'sms';
    }
    if (t === 'ai.action') return null; // paired with <resource>.changed
    return null;
  }

  function dispatch(ev) {
    if (!ev || typeof ev.id !== 'number') return;
    if (markApplied(ev.id)) return; // replayed duplicate

    if (ev.id > lastSeq) {
      lastSeq = ev.id;
      safeStorageSet('jf_realtime_seq', String(lastSeq));
    }
    lastSyncAt = Date.now();

    var fns = listeners[ev.type];
    if (fns) for (var i = 0; i < fns.length; i++) emit(ev.type, fns[i], ev);
    for (var a = 0; a < anyListeners.length; a++) emit('*', anyListeners[a], ev);

    handleChange(ev);
    handleNotify(ev);
    renderIndicator();
  }

  function handleChange(ev) {
    var resource = resourceOf(ev);
    for (var i = 0; i < changeSubs.length; i++) {
      var sub = changeSubs[i];
      if (sub.resources && resource && !sub.resources.has(resource)) continue;
      if (sub.resources && !resource) continue;
      scheduleReload(sub);
    }
  }

  function scheduleReload(sub) {
    if (document.hidden) {
      // Background tab: don't burn requests, refresh the moment it is looked at.
      sub.dirty = true;
      return;
    }
    if (sub.timer) clearTimeout(sub.timer);
    sub.timer = setTimeout(function () {
      sub.timer = null;
      try {
        sub.reload();
      } catch (err) {
        if (window.console) console.warn('[realtime] reload failed', err);
      }
    }, CHANGE_DEBOUNCE_MS);
  }

  function handleNotify(ev) {
    var builder = NOTIFY_TYPES[ev.type];
    if (!builder) return;
    // Our own mutation — we already saw the result on screen, stay quiet.
    if (ev.source && ev.source === SELF_ID) return;

    var notice;
    try {
      notice = builder(ev.data || {});
    } catch (_) {
      return;
    }
    if (!notice) return;

    if (notifyListeners.length) {
      for (var i = 0; i < notifyListeners.length; i++) {
        emit('notify', notifyListeners[i], { notice: notice, event: ev });
      }
      return;
    }

    // Default behaviour: in-page chime + OS notification if the user allowed it.
    try {
      if (window.finproAudio && typeof window.finproAudio.triggerNotification === 'function') {
        window.finproAudio.triggerNotification(notice);
      }
    } catch (_) {}
  }

  // ------------------------------------------------------------------ streams

  function streamURL() {
    var q = '?token=' + encodeURIComponent(getToken() || '');
    if (lastSeq > 0) q += '&lastEventId=' + lastSeq;
    return API_BASE + '/realtime/stream' + q;
  }

  function setState(name, nextTransport) {
    stateName = name;
    if (nextTransport) transport = nextTransport;
    renderIndicator();
  }

  function onOpen() {
    failures = 0;
    stopPolling();
    setState('live', 'sse');
    renderIndicator();
    // The server confirms the resume watermark in the `hello` frame; a large gap
    // means the replay buffer rolled over, so force a full refresh.
  }

  function onSseError() {
    if (stopped) return;
    failures++;
    closeStream();
    if (failures >= POLL_AFTER_FAILURES) {
      startPolling();
      setState('polling', 'polling');
    } else {
      setState('connecting');
    }
    scheduleReconnect();
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    var delay = Math.min(
      BACKOFF_BASE_MS * Math.pow(2, Math.max(0, failures - 1)),
      BACKOFF_MAX_MS
    );
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function closeStream() {
    if (es) {
      try {
        es.close();
      } catch (_) {}
      es = null;
    }
  }

  function connect() {
    if (stopped) return;
    if (!getToken()) {
      setState('offline');
      return;
    }
    if (es) return;

    if (typeof window.EventSource !== 'function') {
      // Old browser — polling is the only option.
      startPolling();
      setState('polling', 'polling');
      return;
    }

    setState('connecting');
    try {
      es = new EventSource(streamURL());
    } catch (_) {
      failures++;
      scheduleReconnect();
      return;
    }

    es.addEventListener('open', onOpen);
    es.addEventListener('error', onSseError);

    es.addEventListener('hello', function (e) {
      try {
        var hello = JSON.parse(e.data);
        failures = 0;
        setState('live', 'sse');
        // Replay window exhausted → stop trusting the delta and refetch all.
        if (hello && typeof hello.seq === 'number' && hello.seq - lastSeq > LOG_LIMIT) {
          forceFullRefresh();
        }
      } catch (_) {}
    });

    // Universal safety net: every mutation publishes this.
    es.addEventListener('sync.changed', function (e) {
      applyFrame(e);
    });

    // Rich typed events — richer UX only; `sync.changed` already covers sync.
    Object.keys(NOTIFY_TYPES).forEach(function (type) {
      es.addEventListener(type, function (e) {
        applyFrame(e);
      });
    });

    // Resource-scoped `*.changed` events emitted by the AI tool layer.
    [
      'account.changed', 'transaction.changed', 'budget.changed', 'goal.changed',
      'investment.changed', 'portfolio.changed', 'loan.changed', 'insurance.changed',
      'subscription.changed', 'card.changed', 'task.changed', 'calendar.changed',
      'profile.changed', 'ai.action',
    ].forEach(function (type) {
      es.addEventListener(type, function (e) {
        applyFrame(e);
      });
    });
  }

  function applyFrame(e) {
    if (!e || !e.data) return;
    var ev;
    try {
      ev = JSON.parse(e.data);
    } catch (_) {
      return;
    }
    // Prefer the SSE-level id (authoritative for replay) over the body copy.
    if (e.lastEventId) {
      var n = Number(e.lastEventId);
      if (isFinite(n) && n > 0) ev.id = n;
    }
    dispatch(ev);
  }

  // ------------------------------------------------------------------ polling

  function startPolling() {
    if (pollTimer || stopped) return;
    pollTimer = setInterval(pull, POLL_MS);
    pull();
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function pull() {
    if (stopped) return Promise.resolve();
    var token = getToken();
    if (!token) return Promise.resolve();

    return fetch(API_BASE + '/realtime/changes?since=' + lastSeq, {
      headers: { Authorization: 'Bearer ' + token },
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (body) {
        var data = (body && body.data) || {};
        var events = data.events || [];
        for (var i = 0; i < events.length; i++) dispatch(events[i]);
        if (typeof data.seq === 'number' && data.seq < lastSeq) {
          // Server restarted / log reset — realign the watermark.
          lastSeq = data.seq;
          safeStorageSet('jf_realtime_seq', String(lastSeq));
        }
        if (stateName === 'polling') renderIndicator();
      })
      .catch(function () {
        if (stateName !== 'offline') setState('offline', transport);
      });
  }

  /** Force every subscriber to refetch (used when the replay window rolls over). */
  function forceFullRefresh() {
    for (var i = 0; i < changeSubs.length; i++) scheduleReload(changeSubs[i]);
  }

  // ----------------------------------------------------------------- indicator

  function buildIndicator() {
    if (indicator || !document.body) return;
    if (!getToken()) return;

    // Stylesheet (not inline) so the pill can dodge the sidebar and reflow on
    // narrow screens where the sidebar slides away.
    if (!document.getElementById('finproSyncStyles')) {
      var style = document.createElement('style');
      style.id = 'finproSyncStyles';
      style.textContent =
        '#finproSyncIndicator{position:fixed;bottom:18px;left:calc(var(--sidebar-w,260px) + 16px);' +
        'z-index:9998;display:flex;align-items:center;gap:8px;padding:7px 12px;' +
        'border-radius:999px;cursor:pointer;font-size:11.5px;font-weight:600;' +
        'letter-spacing:.01em;background:var(--surface,#111827);color:var(--text,#e5e7eb);' +
        'border:1px solid var(--border,#1f2937);box-shadow:0 6px 24px rgba(0,0,0,.28);' +
        'opacity:.9;transition:opacity .2s ease,transform .2s ease;user-select:none;' +
        'font-family:inherit;white-space:nowrap;}' +
        '#finproSyncIndicator:hover{opacity:1;transform:translateY(-1px);}' +
        '#finproSyncIndicator .finpro-sync-dot{width:7px;height:7px;border-radius:50%;' +
        'background:#f59e0b;flex-shrink:0;transition:background .2s ease;}' +
        '#finproSyncIndicator.finpro-live .finpro-sync-dot{animation:finproSyncPulse 2.4s ease-out infinite;}' +
        '@keyframes finproSyncPulse{0%{box-shadow:0 0 0 0 rgba(16,185,129,.5)}' +
        '70%{box-shadow:0 0 0 8px rgba(16,185,129,0)}100%{box-shadow:0 0 0 0 rgba(16,185,129,0)}}' +
        '@media(max-width:768px){#finproSyncIndicator{left:16px;bottom:14px;}}';
      document.head.appendChild(style);
    }

    indicator = document.createElement('div');
    indicator.id = 'finproSyncIndicator';
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-live', 'polite');

    indicatorDot = document.createElement('span');
    indicatorDot.className = 'finpro-sync-dot';

    indicatorText = document.createElement('span');
    indicatorText.textContent = 'Connecting…';

    indicator.appendChild(indicatorDot);
    indicator.appendChild(indicatorText);

    indicator.addEventListener('click', function () {
      refreshNow();
    });

    document.body.appendChild(indicator);

    if (!indicatorTimer) {
      indicatorTimer = setInterval(renderIndicator, 1000);
    }
    renderIndicator();
  }

  function renderIndicator() {
    if (!indicator) return;
    var color = '#f59e0b';
    var label = 'Connecting…';

    indicator.classList.toggle('finpro-live', stateName === 'live');

    if (stateName === 'live') {
      color = '#10b981';
      label = 'Live · synced ' + ago(lastSyncAt || Date.now());
    } else if (stateName === 'polling') {
      color = '#f59e0b';
      label = 'Polling · ' + ago(lastSyncAt || Date.now());
    } else if (stateName === 'offline') {
      color = '#ef4444';
      label = 'Offline — retrying';
    }

    indicatorDot.style.background = color;
    indicatorDot.style.boxShadow = '0 0 10px ' + color;
    indicatorText.textContent = label;
    indicator.title =
      'Realtime sync: ' + stateName +
      (transport ? ' (' + transport + ')' : '') +
      '\nClick to refresh now';
  }

  // --------------------------------------------------------------------- API

  function normalizeResources(resources) {
    if (!resources || resources === '*') return null;
    var arr = Array.isArray(resources) ? resources : [resources];
    var set = new Set();
    arr.forEach(function (r) {
      if (!r) return;
      set.add(r);
      if (RESOURCE_ALIAS[r]) set.add(RESOURCE_ALIAS[r]);
    });
    return set.size ? set : null;
  }

  var realtime = {
    /**
     * Subscribe this page to server changes.
     *   mount({ resources: ['transactions','accounts'], reload: loadAll })
     * Resources are plural keys (see RESOURCE_ALIAS). Pass '*' (or omit) to
     * refresh on every change.
     */
    mount: function (opts) {
      opts = opts || {};
      var sub = {
        resources: normalizeResources(opts.resources),
        reload: typeof opts.reload === 'function' ? opts.reload : function () {},
        timer: null,
        dirty: false,
      };
      changeSubs.push(sub);
      realtime.start();
      return {
        stop: function () {
          var i = changeSubs.indexOf(sub);
          if (i !== -1) changeSubs.splice(i, 1);
          if (sub.timer) clearTimeout(sub.timer);
        },
        setResources: function (resources) {
          sub.resources = normalizeResources(resources);
        },
      };
    },

    /** Alias kept for readability at call sites. */
    subscribe: function (resources, reload) {
      return realtime.mount({ resources: resources, reload: reload });
    },

    /** Subscribe to a specific event type. `'*'` receives every event. */
    on: function (type, fn) {
      if (typeof fn !== 'function') return function () {};
      if (type === '*') {
        anyListeners.push(fn);
        return function () {
          var i = anyListeners.indexOf(fn);
          if (i !== -1) anyListeners.splice(i, 1);
        };
      }
      (listeners[type] = listeners[type] || []).push(fn);
      realtime.start();
      return function () {
        var arr = listeners[type] || [];
        var i = arr.indexOf(fn);
        if (i !== -1) arr.splice(i, 1);
      };
    },

    off: function (type, fn) {
      if (type === '*') {
        var i = anyListeners.indexOf(fn);
        if (i !== -1) anyListeners.splice(i, 1);
        return;
      }
      var arr = listeners[type] || [];
      var j = arr.indexOf(fn);
      if (j !== -1) arr.splice(j, 1);
    },

    /** Override the cross-device notification behaviour for this page. */
    onNotify: function (fn) {
      if (typeof fn === 'function') notifyListeners.push(fn);
    },

    /** Convenience: fire only for SMS / mobile-originated ledger changes. */
    onSmsNotice: function (fn) {
      return realtime.on('*', function (ev) {
        if (
          ev.type === 'sms.pending' ||
          ev.type === 'sms.confirmed' ||
          ev.type === 'transaction.created'
        ) {
          fn(ev);
        }
      });
    },

    start: function () {
      if (stopped) return realtime;
      if (started) return realtime;
      started = true;
      if (!document.body) {
        document.addEventListener('DOMContentLoaded', function () {
          buildIndicator();
        });
      } else {
        buildIndicator();
      }
      connect();
      return realtime;
    },

    stop: function () {
      stopped = true;
      started = false;
      closeStream();
      stopPolling();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (indicatorTimer) {
        clearInterval(indicatorTimer);
        indicatorTimer = null;
      }
      if (indicator && indicator.parentNode) indicator.parentNode.removeChild(indicator);
      indicator = indicatorText = indicatorDot = null;
      setState('idle');
    },

    /** Pull the delta immediately and refresh subscribers. */
    refreshNow: function () {
      return pull().then(function () {
        forceFullRefresh();
      });
    },

    /** Manually dispatch a change (e.g. after a local optimistic mutation). */
    notifyChange: function (resource) {
      handleChange({
        id: -1,
        type: 'sync.changed',
        data: { resource: resource },
      });
    },

    status: function () {
      return {
        state: stateName,
        transport: transport,
        lastSeq: lastSeq,
        lastSyncAt: lastSyncAt,
        failures: failures,
        clientId: SELF_ID,
      };
    },

    isLive: function () {
      return stateName === 'live';
    },

    apiBase: API_BASE,
  };

  // ------------------------------------------------------ lifecycle listeners

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    // Refresh anything that went stale while the tab was in the background.
    for (var i = 0; i < changeSubs.length; i++) {
      if (changeSubs[i].dirty) {
        changeSubs[i].dirty = false;
        scheduleReload(changeSubs[i]);
      }
    }
    if (started && !realtime.isLive()) {
      failures = 0;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      connect();
    }
    if (started) pull();
  });

  window.addEventListener('online', function () {
    if (!started) return;
    failures = 0;
    connect();
    pull();
  });

  window.addEventListener('offline', function () {
    if (started) setState('offline', transport);
  });

  window.addEventListener('beforeunload', function () {
    closeStream();
  });

  window.finproRealtime = realtime;

  // Auto-start on authenticated pages; login/signup have no token so nothing
  // connects (and no indicator is drawn).
  if (getToken()) realtime.start();
})();
