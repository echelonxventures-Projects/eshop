const counters = new Map();
const startedAt = Date.now();
const samples = [];

function increment(name, value = 1) { counters.set(name, (counters.get(name) || 0) + value); }

export function recordRequest({method, route, status, durationMs}) {
  increment('marketly_http_requests_total');
  increment(`marketly_http_requests_total{method="${method}",route="${route}",status="${status}"}`);
  increment(`marketly_http_request_duration_ms_total{method="${method}",route="${route}"}`, durationMs);
  if (status >= 500) increment('marketly_http_errors_total');
  samples.push({status,durationMs,at:Date.now()});
  if (samples.length > 5000) samples.splice(0, samples.length - 5000);
}

export function recordWebhook(serviceType, status) {
  increment('marketly_webhooks_total');
  increment(`marketly_webhooks_total{service_type="${serviceType}",status="${status}"}`);
}

function metricName(name) { return name.replace(/[^a-zA-Z0-9_:]/g, '_'); }

export function metricsText() {
  const lines = [
    '# HELP marketly_process_uptime_seconds API process uptime.',
    '# TYPE marketly_process_uptime_seconds gauge',
    `marketly_process_uptime_seconds ${(Date.now() - startedAt) / 1000}`
  ];
  for (const [name, value] of counters) lines.push(`${metricName(name)} ${value}`);
  return `${lines.join('\n')}\n`;
}

export function sloSnapshot(windowMs = 300000) {
  const cutoff = Date.now() - windowMs;
  const recent = samples.filter(sample => sample.at >= cutoff);
  const failures = recent.filter(sample => sample.status >= 500).length;
  const durations = recent.map(sample => sample.durationMs).sort((a, b) => a - b);
  const p95 = durations.length ? durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)] : 0;
  return {windowMs, requests:recent.length, failures, availability:recent.length ? Number(((recent.length - failures) / recent.length).toFixed(5)) : 1, p95LatencyMs:Number(p95.toFixed(2))};
}

export function metricsMiddleware(req, res, next) {
  const started = process.hrtime.bigint();
  res.on('finish', () => recordRequest({method:req.method, route:req.route?.path || req.path, status:res.statusCode, durationMs:Number(process.hrtime.bigint() - started) / 1e6}));
  next();
}
