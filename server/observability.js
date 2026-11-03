const counters = new Map();
const startedAt = Date.now();

function increment(name, value = 1) { counters.set(name, (counters.get(name) || 0) + value); }

export function recordRequest({method, route, status, durationMs}) {
  increment('marketly_http_requests_total');
  increment(`marketly_http_requests_total{method="${method}",route="${route}",status="${status}"}`);
  increment(`marketly_http_request_duration_ms_total{method="${method}",route="${route}"}`, durationMs);
  if (status >= 500) increment('marketly_http_errors_total');
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

export function metricsMiddleware(req, res, next) {
  const started = process.hrtime.bigint();
  res.on('finish', () => recordRequest({method:req.method, route:req.route?.path || req.path, status:res.statusCode, durationMs:Number(process.hrtime.bigint() - started) / 1e6}));
  next();
}
