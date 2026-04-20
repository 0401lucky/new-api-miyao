import { loadSites, saveSites } from '../../../_lib/site-store.js';
import { json, readJson } from '../../../_lib/http.js';

export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  const ids = Array.isArray(body?.ids) ? body.ids.map(id => String(id)) : [];

  if (!ids.length) {
    return json({ success: false, message: '排序列表不能为空' }, 400);
  }

  try {
    const sites = await loadSites(env);
    if (sites.length !== ids.length) {
      return json({ success: false, message: '排序列表与站点数量不一致' }, 400);
    }

    const siteMap = new Map(sites.map(site => [site.id, site]));
    const reordered = ids.map(id => siteMap.get(id)).filter(Boolean);
    if (reordered.length !== sites.length) {
      return json({ success: false, message: '排序列表包含无效站点' }, 400);
    }

    await saveSites(env, reordered);
    return json({ success: true, data: { sites: reordered } });
  } catch (error) {
    return json({ success: false, message: error.message || '排序失败' }, 500);
  }
}
