import { MetricsRegistry } from './metrics.registry.js';

describe('MetricsRegistry (pure)', () => {
  it('counts by handler/method/status and renders Prometheus text', () => {
    const m = new MetricsRegistry();
    m.observe({ handler: 'A.b', method: 'GET', status: 200, durationMs: 30 });
    m.observe({ handler: 'A.b', method: 'GET', status: 200, durationMs: 1200 });
    m.observe({ handler: 'A.b', method: 'GET', status: 403, durationMs: 10 });
    expect(m.countFor('GET', 'A.b', 200)).toBe(2);
    expect(m.countFor('GET', 'A.b', 403)).toBe(1);
    expect(m.countFor('GET', 'A.b', 500)).toBe(0);
    const text = m.render();
    expect(text).toContain('pulse_http_requests_total{method="GET",handler="A.b",status="200"} 2');
    expect(text).toContain('le="25"} 1');
    expect(text).toContain('le="2500"} 3');
  });

  it('never throws on odd input (metrics must not break requests)', () => {
    const m = new MetricsRegistry();
    expect(() => m.observe({ handler: '', method: '', status: NaN, durationMs: -1 })).not.toThrow();
  });

  it('snapshot aggregates totals and error rate for alerting', () => {
    const m = new MetricsRegistry();
    expect(m.snapshot()).toEqual({ totalRequests: 0, serverErrors: 0, errorRate: 0 });
    m.observe({ handler: 'A.b', method: 'GET', status: 200, durationMs: 5 });
    m.observe({ handler: 'A.b', method: 'GET', status: 503, durationMs: 5 });
    m.observe({ handler: 'C.d', method: 'POST', status: 404, durationMs: 5 });
    expect(m.snapshot()).toEqual({ totalRequests: 3, serverErrors: 1, errorRate: 1 / 3 });
  });
});
