/**
 * Metrics registry — format and cardinality-safety tests.
 */

const metrics = require('../services/metrics');

afterEach(() => {
  metrics.reset();
});

describe('Prometheus rendering', () => {
  test('renders counters and gauges with escaped labels', () => {
    metrics.defineCounter('unit_test_requests_total', 'Test counter.', ['route']);
    metrics.increment('unit_test_requests_total', { route: '/a"b\\c' }, 2);
    metrics.defineGauge('unit_test_inflight', 'Test gauge.');
    metrics.setGauge('unit_test_inflight', {}, 3);

    const output = metrics.render();
    expect(output).toContain('# TYPE unit_test_requests_total counter');
    expect(output).toContain('unit_test_requests_total{route="/a\\"b\\\\c"} 2');
    expect(output).toContain('unit_test_inflight 3');
  });

  test('renders cumulative histogram buckets', () => {
    metrics.defineHistogram(
      'unit_test_latency_seconds',
      'Test histogram.',
      ['route'],
      [0.1, 0.5, 1]
    );
    metrics.observe('unit_test_latency_seconds', { route: '/x' }, 0.05);
    metrics.observe('unit_test_latency_seconds', { route: '/x' }, 0.3);
    metrics.observe('unit_test_latency_seconds', { route: '/x' }, 2);

    const output = metrics.render();
    expect(output).toContain('unit_test_latency_seconds_bucket{route="/x",le="0.1"} 1');
    expect(output).toContain('unit_test_latency_seconds_bucket{route="/x",le="0.5"} 2');
    expect(output).toContain('unit_test_latency_seconds_bucket{route="/x",le="1"} 2');
    expect(output).toContain('unit_test_latency_seconds_bucket{route="/x",le="+Inf"} 3');
    expect(output).toContain('unit_test_latency_seconds_sum{route="/x"} 2.35');
    expect(output).toContain('unit_test_latency_seconds_count{route="/x"} 3');
  });

  test('reset clears values but keeps definitions usable', () => {
    metrics.defineCounter('unit_test_reset_total', 'Reset test.');
    metrics.increment('unit_test_reset_total', {}, 5);
    expect(metrics.render()).toContain('unit_test_reset_total 5');

    metrics.reset();
    metrics.increment('unit_test_reset_total', {}, 1);
    const output = metrics.render();
    expect(output).toContain('unit_test_reset_total 1');
    expect(output).not.toContain('unit_test_reset_total 5');
  });

  test('process gauges are always present and no label contains free text', () => {
    const output = metrics.render();
    expect(output).toContain('finpro_process_resident_memory_bytes');
    expect(output).toContain('finpro_process_heap_used_bytes');
    expect(output).toContain('finpro_process_uptime_seconds');
    expect(output).not.toMatch(/api[_-]?key|token|password/i);
  });

  test('ignores invalid observations instead of throwing', () => {
    metrics.defineHistogram('unit_test_bad_seconds', 'Bad values.', [], [1]);
    expect(() => metrics.observe('unit_test_bad_seconds', {}, -1)).not.toThrow();
    expect(() => metrics.observe('unit_test_bad_seconds', {}, Number.NaN)).not.toThrow();
    expect(() => metrics.increment('unit_test_missing_total')).not.toThrow();
  });
});
