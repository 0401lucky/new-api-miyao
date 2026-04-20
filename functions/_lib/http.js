const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

export function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers(JSON_HEADERS);
  Object.entries(extraHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });
  return new Response(JSON.stringify(data), { status, headers });
}

export function noContent(extraHeaders = {}) {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  Object.entries(extraHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });
  return new Response(null, { status: 204, headers });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function isWriteMethod(method) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

export function requireSameOrigin(request) {
  const origin = request.headers.get('Origin');
  const requestOrigin = new URL(request.url).origin;
  if (!origin) {
    return '缺少 Origin，请从本站页面发起请求';
  }
  if (origin !== requestOrigin) {
    return '请求来源不受信任';
  }
  return null;
}
