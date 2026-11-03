export class HttpError extends Error {
  constructor(status, message, code = 'request_failed', details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function requireBody(body, fields) {
  const missing = fields.filter(field => body?.[field] === undefined || body?.[field] === null || body[field] === '');
  if (missing.length) throw new HttpError(400, `Missing required fields: ${missing.join(', ')}`, 'validation_error');
}

export function pageParams(query, policy = {page:1, pageSize:24, maxPageSize:100}) {
  const page = Math.max(1, Number(query.page || policy.page));
  const pageSize = Math.min(policy.maxPageSize, Math.max(1, Number(query.pageSize || policy.pageSize)));
  return {page, pageSize, offset:(page - 1) * pageSize};
}
