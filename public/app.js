(() => {
  const CFG = window.APP_CONFIG || {};
  const $ = sel => document.querySelector(sel);
  const state = {
    source: 'fallback',
    sites: [],
  };

  // ========== 品牌渲染 ==========
  function applyBranding() {
    document.title = `${CFG.shopName || '密钥额度查询'} · 密钥额度查询`;
    $('#brandEmoji').textContent = CFG.logoEmoji || '⚡';
    $('#brandName').textContent = CFG.shopName || '密钥额度查询';
    $('#brandTagline').textContent = CFG.tagline || '';
    $('#footerNote').textContent = CFG.footerNote || '';

    const topup = $('#navTopup');
    const support = $('#navSupport');
    if (CFG.topupUrl) {
      topup.href = CFG.topupUrl;
      topup.classList.remove('hidden');
      $('#topupBtn').href = CFG.topupUrl;
      $('#topupBtn').classList.remove('hidden');
    }
    if (CFG.supportUrl) {
      support.href = CFG.supportUrl;
      support.classList.remove('hidden');
    }
  }

  // ========== toast ==========
  function toast(msg, type = 'error') {
    const host = $('#toast');
    const color = type === 'error'
      ? 'bg-rose-950/85 border-rose-500/40 text-rose-100'
      : 'bg-emerald-950/85 border-emerald-500/40 text-emerald-100';
    const el = document.createElement('div');
    el.className = `toast pointer-events-auto mx-4 mt-2 max-w-md px-4 py-2.5 rounded-xl border backdrop-blur-md shadow-xl text-sm ${color}`;
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => el.remove(), 3800);
  }

  // ========== 工具 ==========
  const quotaPerUnit = () => CFG.quotaPerUnit || 500000;
  const toUSD = q => q / quotaPerUnit();
  const fmtUSD = q => `$${toUSD(q).toFixed(4)}`;
  const fmtCNY = q => CFG.cnyRate ? `≈ ¥${(toUSD(q) * CFG.cnyRate).toFixed(2)}` : '';
  const fmtQuota = q => `${Number(q).toLocaleString('en-US')} quota`;
  const fmtDate = ts => ts === 0 ? '永不过期' : new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false });
  function fmtRel(ts) {
    if (ts === 0) return '无限期';
    const diff = ts * 1000 - Date.now();
    if (diff <= 0) return '已过期';
    const d = Math.floor(diff / 86400000);
    if (d >= 1) return `剩 ${d} 天`;
    const h = Math.floor(diff / 3600000);
    if (h >= 1) return `剩 ${h} 小时`;
    const m = Math.floor(diff / 60000);
    return `剩 ${m} 分钟`;
  }
  function maskKey(k) {
    if (!k) return '';
    const s = k.startsWith('sk-') ? k : `sk-${k}`;
    if (s.length <= 14) return s;
    return `${s.slice(0, 7)}••••${s.slice(-4)}`;
  }

  function normalizeFallbackSites() {
    return (CFG.backends || [])
      .filter(site => site && site.url)
      .map(site => ({
        value: String(site.url).trim(),
        label: site.label || String(site.url).trim(),
      }))
      .filter(site => /^https?:\/\//.test(site.value));
  }

  function renderSiteOptions(sites, source) {
    const sel = $('#backendSelect');
    const remembered = localStorage.getItem('newapi-query:backend');
    state.sites = sites;
    state.source = source;

    sel.innerHTML = '';
    if (!sites.length) {
      sel.innerHTML = '<option value="">（暂无可用站点，请联系管理员）</option>';
      sel.disabled = true;
      $('#siteHint').textContent = '当前没有可查询的站点。';
      return;
    }

    sites.forEach(site => {
      const option = document.createElement('option');
      option.value = site.value;
      option.textContent = site.label;
      sel.appendChild(option);
    });

    sel.disabled = false;
    if (remembered && sites.some(site => site.value === remembered)) {
      sel.value = remembered;
    }

    $('#siteHint').textContent = source === 'remote'
      ? '站点列表由后台实时维护，新增或停用后刷新页面即可看到。'
      : '当前使用 config.js 里的静态站点列表；后台尚未写入站点配置。';
  }

  async function loadSites() {
    const sel = $('#backendSelect');
    sel.innerHTML = '<option value="">正在加载站点…</option>';
    sel.disabled = true;

    try {
      const resp = await fetch('/api/sites', { headers: { Accept: 'application/json' } });
      const data = await resp.json().catch(() => ({}));
      const sites = Array.isArray(data?.data?.sites)
        ? data.data.sites.map(site => ({ value: site.id, label: site.label }))
        : [];
      if (resp.ok && sites.length) {
        renderSiteOptions(sites, 'remote');
        return;
      }
    } catch {
      // 回退到静态配置
    }

    renderSiteOptions(normalizeFallbackSites(), 'fallback');
  }

  // ========== 本地记忆 ==========
  const LS_KEY = 'newapi-query:key';
  const LS_BACKEND = 'newapi-query:backend';

  function loadRemembered() {
    const key = localStorage.getItem(LS_KEY);
    if (key) {
      $('#apiKey').value = key.startsWith('sk-') ? key.slice(3) : key;
      $('#remember').checked = true;
    }
    localStorage.removeItem('newapi-query:custom');
  }

  function persistMemory(selectedValue, key) {
    if ($('#remember').checked) {
      localStorage.setItem(LS_KEY, key);
      localStorage.setItem(LS_BACKEND, selectedValue);
    } else {
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem(LS_BACKEND);
    }
  }

  // ========== 眼睛切换 ==========
  $('#toggleEye').addEventListener('click', () => {
    const input = $('#apiKey');
    const isPw = input.type === 'password';
    input.type = isPw ? 'text' : 'password';
    $('#eyeOpen').classList.toggle('hidden', !isPw);
    $('#eyeClose').classList.toggle('hidden', isPw);
  });

  // ========== 查询 ==========
  function getKey() {
    const value = ($('#apiKey').value || '').trim();
    if (!value) return '';
    return value.startsWith('sk-') ? value : `sk-${value}`;
  }

  function setLoading(on) {
    $('#submitBtn').disabled = on;
    $('#btnLabel').textContent = on ? '查询中…' : '查询额度';
    $('#btnSpinner').classList.toggle('hidden', !on);
    $('#resultWrap').classList.remove('hidden');
    $('#skeletonBlock').classList.toggle('hidden', !on);
    if (on) $('#resultBlock').classList.add('hidden');
  }

  async function query() {
    const selectedValue = ($('#backendSelect').value || '').trim();
    const key = getKey();

    if (!selectedValue) {
      toast('请选择查询站点');
      return;
    }
    if (!/^sk-\S+$/.test(key)) {
      toast('请输入 sk- 开头的密钥');
      return;
    }

    const payload = state.source === 'remote'
      ? { siteId: selectedValue, key }
      : { backend: selectedValue, key };

    setLoading(true);
    try {
      const resp = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data?.success === false) {
        renderError(data?.message || `请求失败（${resp.status}）`);
        return;
      }
      renderResult(data, key);
      persistMemory(selectedValue, key);
    } catch (error) {
      renderError(`网络错误：${error.message || 'unknown'}`);
    } finally {
      setLoading(false);
    }
  }

  function renderError(msg) {
    $('#resultWrap').classList.add('hidden');
    toast(msg);
  }

  function renderResult(resp, key) {
    const d = resp?.data || {};
    const unlimited = !!d.unlimited_quota;
    const granted = Number(d.total_granted || 0);
    const used = Number(d.total_used || 0);
    const available = Number(d.total_available ?? (granted - used));
    const expiresAt = Number(d.expires_at || 0);

    $('#tokenName').textContent = d.name || '—';
    $('#keyMask').textContent = maskKey(key);

    if (unlimited) {
      $('#remainUSD').textContent = '♾️';
      $('#remainCNY').textContent = '';
      $('#progressWrap').classList.add('hidden');
      $('#unlimitedView').classList.remove('hidden');
    } else {
      $('#remainUSD').textContent = fmtUSD(available);
      $('#remainCNY').textContent = fmtCNY(available);
      $('#progressWrap').classList.remove('hidden');
      $('#unlimitedView').classList.add('hidden');

      const pct = granted > 0 ? Math.min(100, Math.max(0, (used / granted) * 100)) : 0;
      $('#usedPercent').textContent = pct.toFixed(1);
      const bar = $('#bar');
      bar.style.width = `${pct}%`;
      bar.classList.toggle('bar-danger', pct >= 90);
    }

    $('#usedUSD').textContent = fmtUSD(used);
    $('#usedQuota').textContent = fmtQuota(used);
    $('#totalUSD').textContent = unlimited ? '♾️' : fmtUSD(granted);
    $('#totalQuota').textContent = unlimited ? '无限额度' : fmtQuota(granted);

    const expired = expiresAt !== 0 && expiresAt * 1000 < Date.now();
    $('#expireTxt').textContent = fmtDate(expiresAt);
    $('#expireTxt').classList.toggle('text-rose-400', expired);
    $('#expireTxt').classList.toggle('text-slate-200', !expired);
    $('#expireRel').textContent = fmtRel(expiresAt);
    $('#expireRel').classList.toggle('text-rose-400', expired);

    const enabled = !!d.model_limits_enabled;
    const limits = d.model_limits || {};
    const names = Object.keys(limits).filter(name => limits[name]);
    if (enabled && names.length) {
      $('#modelBlock').classList.remove('hidden');
      const host = $('#modelTags');
      host.innerHTML = '';
      names.forEach(name => {
        const item = document.createElement('span');
        item.className = 'tag text-xs font-mono px-2.5 py-1 rounded-full text-slate-200';
        item.textContent = name;
        host.appendChild(item);
      });
    } else {
      $('#modelBlock').classList.add('hidden');
    }

    $('#copyBtn').onclick = async () => {
      const lines = [
        `令牌：${d.name || '-'} (${maskKey(key)})`,
        unlimited
          ? '剩余：无限额度'
          : `剩余：${fmtUSD(available)}（已用 ${fmtUSD(used)} / 共 ${fmtUSD(granted)}）`,
        `到期：${fmtDate(expiresAt)}${expired ? '（已过期）' : ''}`,
      ];
      try {
        await navigator.clipboard.writeText(lines.join('\n'));
        toast('已复制到剪贴板', 'success');
      } catch {
        toast('复制失败：请手动选择复制');
      }
    };

    $('#resultWrap').classList.remove('hidden');
    $('#skeletonBlock').classList.add('hidden');
    $('#resultBlock').classList.remove('hidden');

    if (expired) toast('该密钥已过期', 'error');
  }

  async function init() {
    applyBranding();
    loadRemembered();
    await loadSites();
    $('#queryForm').addEventListener('submit', event => {
      event.preventDefault();
      query();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
