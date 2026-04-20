import { json } from '../_lib/http.js';
import { loadSites, toPublicSites } from '../_lib/site-store.js';

export async function onRequestGet({ env }) {
  try {
    if (!env?.SITE_CONFIG) {
      return json({ success: true, data: { sites: [] } });
    }
    const sites = await loadSites(env);
    return json({ success: true, data: { sites: toPublicSites(sites) } });
  } catch {
    return json({ success: false, message: '读取站点列表失败' }, 500);
  }
}
