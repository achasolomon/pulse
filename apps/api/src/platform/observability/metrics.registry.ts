/**
 * Minimal Prometheus-text metrics (OPS-001 observability, EPIC-23 baseline).
 * In-memory, process-local, low cardinality: labels are handler names, never
 * patient IDs, URLs, or request bodies. A shared collector would replace this
 * when the worker/gateway split lands.
 */

export interface RequestSample {
  handler: string;
  method: string;
  status: number;
  durationMs: number;
}

const LATENCY_BUCKETS = [25, 50, 100, 250, 500, 1000, 2500];

export class MetricsRegistry {
  private counts = new Map<string, number>();
  private buckets = new Map<string, number[]>();

  observe(sample: RequestSample): void {
    const key = `${sample.method} ${sample.handler} ${sample.status}`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    const bucketKey = `${sample.method} ${sample.handler}`;
    const arr = this.buckets.get(bucketKey) ?? Array.from({ length: LATENCY_BUCKETS.length }, () => 0);
    for (let i = 0; i < LATENCY_BUCKETS.length; i++) {
      if (sample.durationMs <= (LATENCY_BUCKETS[i] as number)) {
        arr[i] = (arr[i] as number) + 1;
      }
    }
    this.buckets.set(bucketKey, arr);
  }

  countFor(method: string, handler: string, status: number): number {
    return this.counts.get(`${method} ${handler} ${status}`) ?? 0;
  }

  /** Aggregate SLI snapshot for alerting (error_rate = 5xx / total). */
  snapshot(): { totalRequests: number; serverErrors: number; errorRate: number } {
    let totalRequests = 0;
    let serverErrors = 0;
    for (const [key, n] of this.counts) {
      totalRequests += n;
      const status = Number(key.split(' ').pop());
      if (status >= 500) serverErrors += n;
    }
    return {
      totalRequests,
      serverErrors,
      errorRate: totalRequests === 0 ? 0 : serverErrors / totalRequests,
    };
  }

  render(): string {
    const lines: string[] = [
      '# HELP pulse_http_requests_total HTTP requests by handler and status.',
      '# TYPE pulse_http_requests_total counter',
    ];
    for (const [key, n] of [...this.counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const [method, ...rest] = key.split(' ');
      const status = rest.pop() ?? '';
      const handler = rest.join(' ');
      lines.push(
        `pulse_http_requests_total{method="${method}",handler="${handler}",status="${status}"} ${n}`,
      );
    }
    lines.push(
      '# HELP pulse_http_latency_ms_bucket Request latency histogram (cumulative).',
      '# TYPE pulse_http_latency_ms_bucket histogram',
    );
    for (const [key, arr] of [...this.buckets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const [method, ...rest] = key.split(' ');
      const handler = rest.join(' ');
      arr.forEach((n, i) => {
        lines.push(
          `pulse_http_latency_ms_bucket{method="${method}",handler="${handler}",le="${LATENCY_BUCKETS[i]}"} ${n}`,
        );
      });
    }
    return lines.join('\n') + '\n';
  }

  reset(): void {
    this.counts.clear();
    this.buckets.clear();
  }
}

export const metricsRegistry = new MetricsRegistry();
