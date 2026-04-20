import { hasValidAdminSession } from '../../_lib/auth.js';
import { json, isWriteMethod, requireSameOrigin } from '../../_lib/http.js';

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }

  if (isWriteMethod(request.method)) {
    const originError = requireSameOrigin(request);
    if (originError) {
      return json({ success: false, message: originError }, 403);
    }
  }

  if (url.pathname === '/api/admin/login') {
    return next();
  }

  const isAuthed = await hasValidAdminSession(request, env);
  if (!isAuthed) {
    return json({ success: false, message: '未登录或登录已过期' }, 401);
  }

  return next();
}
