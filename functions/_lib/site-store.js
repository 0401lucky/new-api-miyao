const SITE_KEY = 'sites:v1';

export function normalizeBackend(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function getStore(env) {
  const store = env?.SITE_CONFIG;
  if (!store) throw new Error('未配置 SITE_CONFIG 绑定');
  return store;
}

function normalizeLoadedSites(input) {
  if (!Array.isArray(input)) throw new Error('SITE_CONFIG 中的站点数据格式无效');
  return input.map(item => ({
    id: String(item?.id || ''),
    label: String(item?.label || '').trim(),
    url: normalizeBackend(item?.url || ''),
    enabled: item?.enabled !== false,
    createdAt: String(item?.createdAt || ''),
    updatedAt: String(item?.updatedAt || ''),
  }));
}

export async function loadSites(env) {
  const raw = await getStore(env).get(SITE_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return normalizeLoadedSites(parsed).filter(site => site.id && site.label && site.url);
}

export async function saveSites(env, sites) {
  await getStore(env).put(SITE_KEY, JSON.stringify(sites));
}

export function validateSiteInput(input) {
  const label = String(input?.label || '').trim();
  const url = normalizeBackend(input?.url || '');
  if (!label) return { error: '站点名称不能为空' };
  if (label.length > 40) return { error: '站点名称不能超过 40 个字符' };
  if (!url) return { error: '站点地址必须是有效的 http/https URL' };
  return {
    value: {
      label,
      url,
      enabled: input?.enabled !== false,
    },
  };
}

export function createSiteRecord(input, now = new Date().toISOString()) {
  const validated = validateSiteInput(input);
  if (validated.error) return validated;
  return {
    value: {
      id: crypto.randomUUID(),
      label: validated.value.label,
      url: validated.value.url,
      enabled: validated.value.enabled,
      createdAt: now,
      updatedAt: now,
    },
  };
}

export function updateSiteRecord(previous, input, now = new Date().toISOString()) {
  const validated = validateSiteInput(input);
  if (validated.error) return validated;
  return {
    value: {
      ...previous,
      label: validated.value.label,
      url: validated.value.url,
      enabled: validated.value.enabled,
      updatedAt: now,
    },
  };
}

export function toPublicSites(sites) {
  return sites
    .filter(site => site.enabled)
    .map(site => ({ id: site.id, label: site.label }));
}
