import {HttpError} from './http.js';

export function createRateLimiter({windowMs = 60000, max = 300, key = request => request.ip} = {}) {
  const buckets = new Map();
  let lastSweep = Date.now();
  return (req, res, next) => {
    const now = Date.now();
    if (now - lastSweep > windowMs) { for (const [bucketKey, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(bucketKey); lastSweep = now; }
    const bucketKey = String(key(req));
    const bucket = buckets.get(bucketKey);
    const current = bucket && bucket.resetAt > now ? bucket : {count:0, resetAt:now + windowMs};
    current.count += 1; buckets.set(bucketKey, current);
    res.setHeader('x-ratelimit-limit', max); res.setHeader('x-ratelimit-remaining', Math.max(0, max - current.count)); res.setHeader('x-ratelimit-reset', Math.ceil(current.resetAt / 1000));
    if (current.count > max) { res.setHeader('retry-after', Math.ceil((current.resetAt - now) / 1000)); return next(new HttpError(429, 'Too many requests. Try again later.', 'rate_limit_exceeded')); }
    next();
  };
}
