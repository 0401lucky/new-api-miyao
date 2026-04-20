import { clearAdminSessionCookie } from '../../_lib/auth.js';
import { noContent } from '../../_lib/http.js';

export async function onRequestPost() {
  return noContent({ 'Set-Cookie': clearAdminSessionCookie() });
}
