/**
 * FinPro — Dependency-free Prometheus/OpenMetrics registry.
 *
 * Why hand-rolled instead of prom-client:
 *  - The deployment target is a single Render web service. Pulling a second
 *    metrics stack (Prometheus + Grafana + exporters) would cost more than the
 *    app itself; a text endpoint is enough for an external scraper or an uptime
 *    check.
 *  - The registry is deliberately small and bounded: counters, gauges and
 *    histograms with low-cardinality labels only.
 *
 * Safety rules:
 *  - Never use user ids, emails, tokens, account numbers, transaction ids or
 *    free-text error messages as label values. The HTTP middleware normalises
 *    routes before labelling them.
 *  - No secrets are read or rendered here.
 */

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const MAX_SERIES_PER_METRIC = 2000;

const registry = new Map();
let renderCount = 0;

const escapeLabelValue = (value) =>
  String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"');

const assertName = (name) => {
  if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(name)) {
    throw new Error(`Invalid metric name: ${name}`);
  }
};

const assertLabelNames = (labelNames) => {
  for (const label of labelNames || []) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(label)) {
      throw new Error(`Invalid metric label: ${label}`);
    }
    if (label === 'le') {
      throw new Error('Metric label "le" is reserved for histogram buckets.');
    }
  }
};

const ensure = (name, type, help, labelNames = [], buckets = DEFAULT_BUCKETS) => {
  assertName(name);
  assertLabelNames(labelNames);
  let metric = registry.get(name);
  if (!metric) {
    metric = {
      name,
      type,
      help: help || name,
      labelNames,
      buckets,
      series: new Map(),
      dropped: 0,
    };
    registry.set(name, metric);
  } else if (metric.type !== type) {
    throw new Error(`Metric ${name} already registered as ${metric.type}, not ${type}.`);
  }
  return metric;
};

const labelKey = (labelNames, labels) =>
  labelNames.map((name) => `${name}=${String(labels?.[name] ?? '')}`).join('|');

const getSeries = (metric, labels) => {
  const key = labelKey(metric.labelNames, labels);
  let series = metric.series.get(key);
  if (!series) {
    if (metric.series.size >= MAX_SERIES_PER_METRIC) {
      metric.dropped += 1;
      return null;
    }
    series =
      metric.type === 'histogram'
        ? {
            labels: metric.labelNames.map((name) => [name, String(labels?.[name] ?? '')]),
            count: 0,
            sum: 0,
            bucketCounts: new Array(metric.buckets.length).fill(0),
          }
        : {
            labels: metric.labelNames.map((name) => [name, String(labels?.[name] ?? '')]),
            value: 0,
          };
    metric.series.set(key, series);
  }
  return series;
};

const defineCounter = (name, help, labelNames = []) => {
  ensure(name, 'counter', help, labelNames);
  return (labels = {}, value = 1) => increment(name, labels, value);
};

const defineGauge = (name, help, labelNames = []) => {
  ensure(name, 'gauge', help, labelNames);
  return (labels = {}, value = 0) => setGauge(name, labels, value);
};

const defineHistogram = (name, help, labelNames = [], buckets = DEFAULT_BUCKETS) => {
  ensure(name, 'histogram', help, labelNames, buckets);
  return (labels = {}, value = 0) => observe(name, labels, value);
};

const increment = (name, labels = {}, value = 1) => {
  const metric = registry.get(name);
  if (!metric || metric.type !== 'counter') return;
  const series = getSeries(metric, labels);
  if (series) series.value += Number(value) || 0;
};

const setGauge = (name, labels = {}, value = 0) => {
  const metric = registry.get(name);
  if (!metric || metric.type !== 'gauge') return;
  const series = getSeries(metric, labels);
  if (series) series.value = Number(value) || 0;
};

const observe = (name, labels = {}, value = 0) => {
  const metric = registry.get(name);
  if (!metric || metric.type !== 'histogram') return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return;
  const series = getSeries(metric, labels);
  if (!series) return;
  series.count += 1;
  series.sum += numeric;
  for (let i = 0; i < metric.buckets.length; i += 1) {
    if (numeric <= metric.buckets[i]) series.bucketCounts[i] += 1;
  }
};

const render = () => {
  renderCount += 1;

  // Process gauges are refreshed at scrape time, so they are always current.
  setGauge('finpro_process_resident_memory_bytes', {}, process.memoryUsage().rss);
  setGauge('finpro_process_heap_used_bytes', {}, process.memoryUsage().heapUsed);
  setGauge('finpro_process_uptime_seconds', {}, Math.max(0, process.uptime()));
  increment('finpro_metrics_scrapes_total', {}, 1);

  const lines = [];
  for (const metric of registry.values()) {
    lines.push(`# HELP ${metric.name} ${metric.help.replace(/\n/g, ' ')}`);
    lines.push(`# TYPE ${metric.name} ${metric.type}`);

    if (metric.type === 'histogram') {
      for (const series of metric.series.values()) {
        const base = series.labels.map(([name, value]) => `${name}="${escapeLabelValue(value)}"`);
        for (let i = 0; i < metric.buckets.length; i += 1) {
          // `observe` already increments every bucket whose bound is >= the
          // observed value, so bucketCounts[i] is the cumulative count.
          const labels = [...base, `le="${metric.buckets[i]}"`].join(',');
          lines.push(`${metric.name}_bucket{${labels}} ${series.bucketCounts[i]}`);
        }
        const infLabels = [...base, 'le="+Inf"'].join(',');
        lines.push(`${metric.name}_bucket{${infLabels}} ${series.count}`);
        lines.push(`${metric.name}_sum{${base.join(',')}} ${series.sum}`);
        lines.push(`${metric.name}_count{${base.join(',')}} ${series.count}`);
      }
    } else {
      for (const series of metric.series.values()) {
        const labels = series.labels.length
          ? `{${series.labels.map(([name, value]) => `${name}="${escapeLabelValue(value)}"`).join(',')}}`
          : '';
        lines.push(`${metric.name}${labels} ${series.value}`);
      }
    }
  }

  return `${lines.join('\n')}\n`;
};

const snapshot = () => {
  const out = {};
  for (const metric of registry.values()) {
    out[metric.name] = {
      type: metric.type,
      help: metric.help,
      series: metric.series.size,
      dropped: metric.dropped,
    };
  }
  return out;
};

const reset = () => {
  // Keep metric definitions: modules register once at require time, so clearing
  // the registry would silently turn every later observation into a no-op.
  for (const metric of registry.values()) {
    metric.series.clear();
    metric.dropped = 0;
  }
  renderCount = 0;
};

const defineBaseMetrics = () => {
  defineGauge('finpro_process_resident_memory_bytes', 'Resident set size of the Node.js process in bytes.');
  defineGauge('finpro_process_heap_used_bytes', 'V8 heap used in bytes.');
  defineGauge('finpro_process_uptime_seconds', 'Seconds since this metrics registry started.');
  defineCounter('finpro_metrics_scrapes_total', 'Number of times the metrics endpoint was rendered.');
};

defineBaseMetrics();

module.exports = {
  defineCounter,
  defineGauge,
  defineHistogram,
  increment,
  setGauge,
  observe,
  render,
  snapshot,
  reset,
};
