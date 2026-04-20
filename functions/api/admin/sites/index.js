import { createSiteRecord, loadSites, saveSites } from '../../../_lib/site-store.js';
import { json, readJson } from '../../../_lib/http.js';

function success(sites) {
  return json({ success: true, data: { sites } });
}

export async function onRequestGet({ env }) {
  try {
    const sites = await loadSites(env);
    return success(sites);
  } catch (error) {
    return json({ success: false, message: error.message || '读取站点失败' }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  const created = createSiteRecord(body);
  if (created.error) {
    return json({ success: false, message: created.error }, 400);
  }

  try {
    const sites = await loadSites(env);
    if (sites.some(site => site.url === created.value.url)) {
      return json({ success: false, message: '该站点地址已存在，请直接编辑原站点' }, 409);
    }
    sites.push(created.value);
    await saveSites(env, sites);
    return success(sites);
  } catch (error) {
    return json({ success: false, message: error.message || '创建站点失败' }, 500);
  }
}
