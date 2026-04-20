import { loadSites, saveSites, updateSiteRecord } from '../../../_lib/site-store.js';
import { json, readJson } from '../../../_lib/http.js';

function success(sites) {
  return json({ success: true, data: { sites } });
}

export async function onRequestPut({ params, request, env }) {
  const siteId = String(params?.id || '');
  const body = await readJson(request);

  try {
    const sites = await loadSites(env);
    const index = sites.findIndex(site => site.id === siteId);
    if (index < 0) {
      return json({ success: false, message: '站点不存在' }, 404);
    }

    const updated = updateSiteRecord(sites[index], body);
    if (updated.error) {
      return json({ success: false, message: updated.error }, 400);
    }
    if (sites.some(site => site.id !== siteId && site.url === updated.value.url)) {
      return json({ success: false, message: '该站点地址已存在，请不要重复配置' }, 409);
    }

    sites[index] = updated.value;
    await saveSites(env, sites);
    return success(sites);
  } catch (error) {
    return json({ success: false, message: error.message || '更新站点失败' }, 500);
  }
}

export async function onRequestDelete({ params, env }) {
  const siteId = String(params?.id || '');

  try {
    const sites = await loadSites(env);
    const nextSites = sites.filter(site => site.id !== siteId);
    if (nextSites.length === sites.length) {
      return json({ success: false, message: '站点不存在' }, 404);
    }
    await saveSites(env, nextSites);
    return success(nextSites);
  } catch (error) {
    return json({ success: false, message: error.message || '删除站点失败' }, 500);
  }
}
