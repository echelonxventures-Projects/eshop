function interpolate(value, payload) {
  if (typeof value === 'string') return value.replace(/\{([\w.-]+)\}/g, (_match, path) => path.split('.').reduce((current, key) => current?.[key], payload) ?? '');
  if (Array.isArray(value)) return value.map(item => interpolate(item, payload));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolate(item, payload)]));
  return value;
}

function joinUrl(baseUrl, path) {
  return `${String(baseUrl).replace(/\/$/, '')}/${String(path || '').replace(/^\//, '')}`;
}

export async function execute({connector, context, payload}) {
  const operation = payload.operation || 'execute';
  const definition = connector.config?.operations?.[operation] || connector.config?.operations?.execute;
  if (!definition?.path) throw new Error(`No HTTP operation configuration exists for ${operation}`);
  const headers = {...(connector.config.headers || {}), ...(definition.headers || {}), 'content-type':'application/json', 'x-platform-tenant':context.tenantId, 'x-platform-universe':context.universeId};
  if (connector.secret) {
    const auth = connector.config.auth || {type:'bearer',header:'authorization'};
    const secret = typeof connector.secret === 'object' ? connector.secret.apiKey || connector.secret.token || connector.secret.value : connector.secret;
    if (secret) headers[auth.header || 'authorization'] = `${auth.prefix ?? (auth.type === 'api_key' ? '' : 'Bearer ')}${secret}`;
  }
  const response = await fetch(joinUrl(connector.config.baseUrl, definition.path), {method:definition.method || 'POST', headers, body:definition.method === 'GET' ? undefined : JSON.stringify(interpolate(definition.body || payload.request || payload, payload))});
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = {raw:text}; }
  if (!response.ok) throw new Error(`Configured provider returned ${response.status}`);
  return interpolate(definition.response || body, body);
}

export async function createIntent(input) { return execute({connector:input.connector, context:input.context, payload:{operation:'createIntent',...input}}); }
export async function getQuotes(input) { return execute({connector:input.connector, context:input.context, payload:{operation:'getQuotes',...input}}); }
export async function test(input) { return execute({connector:input.connector, context:input.context, payload:{operation:'test',...input}}); }
export async function search(input) { return execute({connector:input.connector, context:input.context, payload:{operation:'search',...input}}); }
export async function recommend(input) { return execute({connector:input.connector, context:input.context, payload:{operation:'recommend',...input}}); }
export async function sendNotification(input) { return execute({connector:input.connector, context:input.context, payload:{operation:'sendNotification',...input}}); }
export async function webhook(input) { return execute({connector:input.connector, context:input.context, payload:{operation:'webhook',...input}}); }
