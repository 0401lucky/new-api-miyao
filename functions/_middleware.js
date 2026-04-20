import { hasValidAdminSession } from './_lib/auth.js';

function withNoStore(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isLoginPath(pathname) {
  return pathname === '/admin/login' || pathname === '/admin/login/' || pathname === '/admin/login/index.html';
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (!url.pathname.startsWith('/admin')) {
    return next();
  }

  const isAuthed = await hasValidAdminSession(request, env);
  if (isLoginPath(url.pathname)) {
    if (isAuthed) {
      return Response.redirect(new URL('/admin', url).toString(), 302);
    }
    return withNoStore(await next());
  }

  if (!isAuthed) {
    const loginUrl = new URL('/admin/login', url);
    loginUrl.searchParams.set('next', `${url.pathname}${url.search}`);
    return Response.redirect(loginUrl.toString(), 302);
  }

  return withNoStore(await next());
}
