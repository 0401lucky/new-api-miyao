import { createAdminSessionCookie } from '../../_lib/auth.js';
import { json, noContent, readJson } from '../../_lib/http.js';

export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  const password = String(body?.password || '');
  const expected = String(env?.ADMIN_PASSWORD || '');

  if (!expected) {
    return json({ success: false, message: '服务端未配置 ADMIN_PASSWORD' }, 500);
  }
  if (!password) {
    return json({ success: false, message: '请输入管理密码' }, 400);
  }
  if (password !== expected) {
    return json({ success: false, message: '密码错误' }, 401);
  }

  const cookie = await createAdminSessionCookie(env);
  return noContent({ 'Set-Cookie': cookie });
}
