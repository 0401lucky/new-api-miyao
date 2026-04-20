(() => {
  const CFG = window.APP_CONFIG || {};
  const $ = sel => document.querySelector(sel);

  // ========== 品牌渲染 ==========
  function applyBranding() {
    document.title = `${CFG.shopName || '密钥额度查询'} · 密钥额度查询`;
    $('#brandEmoji').textContent = CFG.logoEmoji || '⚡';
    $('#brandName').textContent  = CFG.shopName || '密钥额度查询';
    $('#brandTagline').textContent = CFG.tagline || '';
    $('#footerNote').textContent = CFG.footerNote || '';

    const topup = $('#navTopup');
    const support = $('#navSupport');
    if (CFG.topupUrl)   { topup.href   = CFG.topupUrl;   topup.classList.remove('hidden'); }
    if (CFG.supportUrl) { support.href = CFG.supportUrl; support.classList.remove('hidden'); }

    if (CFG.topupUrl) {
      const btn = $('#topupBtn');
      btn.href = CFG.topupUrl;
      btn.classList.remove('hidden');
    }
  }

  // ========== 后端列表 ==========
  function applyBackends() {
    const sel = $('#backendSelect');
    const customWrap = $('#customBackendWrap');
    const list = (CFG.backends || []).filter(b => b && b.url);

    sel.innerHTML = '';
    list.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.url;
      opt.textContent = b.label || b.url;
      sel.appendChild(opt);
    });
    if (CFG.allowCustomBackend) {
      const opt = document.createElement('option');
      opt.value = '__custom__';
      opt.textContent = '自定义后端…';
      sel.appendChild(opt);
    }
    if (!list.length && !CFG.allowCustomBackend) {
      sel.innerHTML = '<option value="">（未配置后端，请编辑 config.js）</option>';
    }
    sel.addEventListener('change', () => {
      customWrap.classList.toggle('hidden', sel.value !== '__custom__');
    });
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
  const toUSD   = q => q / quotaPerUnit();
  const fmtUSD  = q => `$${toUSD(q).toFixed(4)}`;
  const fmtCNY  = q => CFG.cnyRate ? `≈ ¥${(toUSD(q) * CFG.cnyRate).toFixed(2)}` : '';
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
    const s = k.startsWith('sk-') ? k : 'sk-' + k;
    if (s.length <= 14) return s;
    return s.slice(0, 7) + '••••' + s.slice(-4);
  }

  // ========== 本地记忆 ==========
  const LS_KEY     = 'newapi-query:key';
  const LS_BACKEND = 'newapi-query:backend';
  const LS_CUSTOM  = 'newapi-query:custom';

  function loadRemembered() {
    const k = localStorage.getItem(LS_KEY);
    const b = localStorage.getItem(LS_BACKEND);
    const c = localStorage.getItem(LS_CUSTOM);
    if (k) {
      $('#apiKey').value = k.startsWith('sk-') ? k.slice(3) : k;
      $('#remember').checked = true;
    }
    if (b) {
      const sel = $('#backendSelect');
      for (const opt of sel.options) if (opt.value === b) { sel.value = b; break; }
      if (sel.value === '__custom__') $('#customBackendWrap').classList.remove('hidden');
    }
    if (c) $('#customBackend').value = c;
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
  function getBackend() {
    const sel = $('#backendSelect');
    if (sel.value === '__custom__') return ($('#customBackend').value || '').trim();
    return (sel.value || '').trim();
  }

  function getKey() {
    const v = ($('#apiKey').value || '').trim();
    if (!v) return '';
    return v.startsWith('sk-') ? v : 'sk-' + v;
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
    const backend = getBackend();
    const key = getKey();

    if (!backend) { toast('请选择或输入后端站点'); return; }
    if (!/^sk-\S+$/.test(key)) { toast('请输入 sk- 开头的密钥'); return; }

    setLoading(true);
    try {
      const resp = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backend, key }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data?.success === false) {
        renderError(data?.message || `请求失败（${resp.status}）`);
        return;
      }
      renderResult(data, key);
      persistMemory(backend, key);
    } catch (e) {
      renderError('网络错误：' + (e.message || 'unknown'));
    } finally {
      setLoading(false);
    }
  }

  function persistMemory(backend, key) {
    if ($('#remember').checked) {
      localStorage.setItem(LS_KEY, key);
      localStorage.setItem(LS_BACKEND, $('#backendSelect').value);
      if ($('#backendSelect').value === '__custom__') {
        localStorage.setItem(LS_CUSTOM, $('#customBackend').value.trim());
      } else {
        localStorage.removeItem(LS_CUSTOM);
      }
    } else {
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem(LS_BACKEND);
      localStorage.removeItem(LS_CUSTOM);
    }
  }

  function renderError(msg) {
    $('#resultWrap').classList.add('hidden');
    toast(msg);
  }

  function renderResult(resp, key) {
    const d = resp?.data || {};
    const unlimited = !!d.unlimited_quota;
    const granted   = Number(d.total_granted || 0);
    const used      = Number(d.total_used || 0);
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
      bar.style.width = pct + '%';
      bar.classList.toggle('bar-danger', pct >= 90);
    }

    $('#usedUSD').textContent    = fmtUSD(used);
    $('#usedQuota').textContent  = fmtQuota(used);
    $('#totalUSD').textContent   = unlimited ? '♾️' : fmtUSD(granted);
    $('#totalQuota').textContent = unlimited ? '无限额度' : fmtQuota(granted);

    const expired = expiresAt !== 0 && expiresAt * 1000 < Date.now();
    $('#expireTxt').textContent = fmtDate(expiresAt);
    $('#expireTxt').classList.toggle('text-rose-400', expired);
    $('#expireTxt').classList.toggle('text-slate-200', !expired);
    $('#expireRel').textContent = fmtRel(expiresAt);
    $('#expireRel').classList.toggle('text-rose-400', expired);

    const enabled = !!d.model_limits_enabled;
    const limits = d.model_limits || {};
    const names = Object.keys(limits).filter(k => limits[k]);
    const block = $('#modelBlock');
    if (enabled && names.length) {
      block.classList.remove('hidden');
      const host = $('#modelTags');
      host.innerHTML = '';
      names.forEach(n => {
        const el = document.createElement('span');
        el.className = 'tag text-xs font-mono px-2.5 py-1 rounded-full text-slate-200';
        el.textContent = n;
        host.appendChild(el);
      });
    } else {
      block.classList.add('hidden');
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

  // ========== init ==========
  function init() {
    applyBranding();
    applyBackends();
    loadRemembered();
    $('#queryForm').addEventListener('submit', e => {
      e.preventDefault();
      query();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
