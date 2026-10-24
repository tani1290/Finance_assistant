/**
 * FinPro — HTTP metrics middleware.
 *
 * Low-cardinality by construction: the route label comes from Express's
 * matched route pattern, never from the raw URL. Unmatched paths are normalised
 * so a scanner cannot create one time series per random path.
 */

const metrics = require('../services/metrics');

metrics.defineCounter(
  'finpro_http_requests_total',
  'HTTP requests by method, route and status code.',
  ['method', 'route', 'status']
);
metrics.defineCounter(
  'finpro_http_errors_total',
  'HTTP 5xx responses by method and route.',
  ['method', 'route']
);
metrics.defineHistogram(
  'finpro_http_request_duration_seconds',
  'HTTP request duration by method, route and status code.',
  ['method', 'route', 'status'],
  [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30]
);
metrics.defineGauge('finpro_http_inflight_requests', 'HTTP requests currently being handled.');

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const LONG_HEX_RE = /\b[0-9a-f]{16,}\b/gi;
const NUMERIC_RE = /\/\d+(?=\/|$)/g;

const normalisePath = (pathname) => {
  const raw = String(pathname || '/').split('?')[0];
  const collapsed = raw
    .replace(UUID_RE, ':id')
    .replace(LONG_HEX_RE, ':id')
    .replace(NUMERIC_RE, '/:id');
  return collapsed.length > 120 ? `${collapsed.slice(0, 117)}...` : collapsed;
};

const routeLabel = (req) => {
  if (req.route?.path) {
    const base = req.baseUrl || '';
    const full = `${base}${req.route.path}`.replace(/\/+/g, '/');
    return full.length > 120 ? `${full.slice(0, 117)}...` : full;
  }
  return normalisePath(req.path || req.originalUrl);
};

let inflight = 0;

const metricsMiddleware = (req, res, next) => {
  const started = process.hrtime.bigint();
  inflight += 1;
  metrics.setGauge('finpro_http_inflight_requests', {}, inflight);

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    inflight = Math.max(0, inflight - 1);
    metrics.setGauge('finpro_http_inflight_requests', {}, inflight);

    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    const route = routeLabel(req);
    const method = String(req.method || 'UNKNOWN').toUpperCase();
    const status = String(res.statusCode || 0);
    metrics.increment('finpro_http_requests_total', { method, route, status });
    metrics.observe('finpro_http_request_duration_seconds', { method, route, status }, seconds);
    if (res.statusCode >= 500) {
      metrics.increment('finpro_http_errors_total', { method, route });
    }
  };

  res.on('finish', finish);
  res.on('close', finish);
  next();
};

module.exports = metricsMiddleware;
module.exports.normalisePath = normalisePath;
module.exports.routeLabel = routeLabel;
