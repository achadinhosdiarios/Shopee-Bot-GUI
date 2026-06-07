const CK = 'acd_cfg_v5';
    const DCFG = { scriptUrl: '', botUrl: '', email: '', pass: '', secret: '', grupo: '', site: '' };
    const PANEL_META = {
      inicio: { title: 'Dashboard Analítico', icon: '🏠' },
      produtos: { title: 'Gestão de Inventário', icon: '📦' },
      automacao: { title: 'Agendamentos Bot', icon: '⏰' },
      historico: { title: 'Histórico Multicanal', icon: '🧾' },
      atividade: { title: 'Console do Sistema', icon: '📋' },
      config: { title: 'Configurações', icon: '⚙️' },
    };

    let prods = [], cronData = [], historicoData = [], authTok = null, logEntries = [], _tt;
    let productById = new Map(), productView = [], historyView = [];
    let productPage = 1, historyPage = 1, previewProductId = null;
    let activePlatform = localStorage.getItem('acd_platform_v6') || 'telegram';
    const PAGE_SIZE = 50;
    const MANAGE_PRODUCTS_CACHE_KEY = 'acd_manage_bot_products_v1';
    const MANAGE_PRODUCTS_CACHE_TTL = 5 * 60 * 1000;
    const CRON_CACHE_TTL = 60 * 1000;
    const HISTORY_CACHE_TTL = 2 * 60 * 1000;
    let _filterTimer = null, _histFilterTimer = null, _globalSearchTimer = null, _loadAllPromise = null, _cronPromise = null, _historyPromise = null, _productSyncTimer = null, _cronsLoadedAt = 0, _historyLoadedAt = 0;

    
function readManageProductsCache() {
      try {
        const payload = JSON.parse(localStorage.getItem(MANAGE_PRODUCTS_CACHE_KEY) || 'null');
        if (!payload || !Array.isArray(payload.data)) return null;
        payload.stale = Date.now() - Number(payload.savedAt || 0) > MANAGE_PRODUCTS_CACHE_TTL;
        return payload;
      } catch (_) {
        return null;
      }
    }

    function saveManageProductsCache(data = prods) {
      try {
        localStorage.setItem(MANAGE_PRODUCTS_CACHE_KEY, JSON.stringify({
          savedAt: Date.now(),
          data
        }));
      } catch (_) { }
    }

    function clearManageProductsCache() {
      try { localStorage.removeItem(MANAGE_PRODUCTS_CACHE_KEY); } catch (_) { }
    }

    function normalizeSearchText(value) {
      return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    }

    function filterTblDebounced() {
      clearTimeout(_filterTimer);
      _filterTimer = setTimeout(filterTbl, 120);
    }

    function filterHistoricoDebounced() {
      clearTimeout(_histFilterTimer);
      _histFilterTimer = setTimeout(filterHistorico, 120);
    }

    function globalSearchDebounced() {
      clearTimeout(_globalSearchTimer);
      _globalSearchTimer = setTimeout(applyGlobalSearch, 140);
    }

    function normalizePlatformKey(value) {
      const v = String(value || '').toLowerCase();
      if (v === 'whatsapp' || v === 'wa' || v === 'zap') return 'whatsapp';
      if (v === 'ambos' || v === 'both' || v === 'all') return 'ambos';
      return 'telegram';
    }

    function platformLabel(value = activePlatform) {
      const p = normalizePlatformKey(value);
      if (p === 'whatsapp') return 'WhatsApp API';
      if (p === 'ambos') return 'Telegram + WhatsApp API';
      return 'Telegram';
    }

    function platformField(value = activePlatform) {
      return normalizePlatformKey(value) === 'whatsapp' ? 'EnvWhatsapp' : 'EnvTelegram';
    }

    function platformPayload(value = activePlatform) {
      return normalizePlatformKey(value);
    }

    function getPlatformResultsSummary(j = {}) {
      const results = j.results || {};
      const entries = Object.entries(results);
      const ok = entries.filter(([, r]) => r && r.ok).map(([p]) => p);
      const fail = entries.filter(([, r]) => !r || !r.ok).map(([p, r]) => ({
        platform: p,
        erro: (r && (r.erro || (r.errors || []).join(' | '))) || 'falha sem detalhe'
      }));
      const warnings = entries.flatMap(([p, r]) => (r && r.warnings || []).map(w => `${p}: ${w}`));
      return { entries, ok, fail, warnings, okAll: entries.length > 0 && fail.length === 0, okAny: ok.length > 0 };
    }

    function logPlatformIssues(j = {}, contexto = 'Envio') {
      const s = getPlatformResultsSummary(j);
      s.fail.forEach(f => addLog(`${contexto} / ${platformLabel(f.platform)}: ${f.erro}`, 'err'));
      s.warnings.forEach(w => addLog(`${contexto}: ${w}`, 'warn'));
      return s;
    }

    function toastPlatformResult(j = {}, successMsg = 'Enviado com sucesso!') {
      const s = getPlatformResultsSummary(j);
      if (!s.entries.length) {
        if (j.status === true || j.status === 'sucesso') return toast(successMsg, 'ok');
        return toast(j.erro || 'Falha no envio.', 'err');
      }
      if (s.okAll) return toast(successMsg, 'ok');
      if (s.okAny) return toast(`Envio parcial: ${s.ok.map(platformLabel).join(' + ')} OK; ${s.fail.map(f => platformLabel(f.platform)).join(' + ')} falhou.`, 'warn');
      return toast(s.fail.map(f => `${platformLabel(f.platform)}: ${f.erro}`).join(' | ') || j.erro || 'Falha no envio.', 'err');
    }

    function cronPlatformValue(value) {
      const v = String(value || 'telegram').toLowerCase();
      if (v.includes('whatsapp') && v.includes('telegram')) return 'ambos';
      if (v.includes('whatsapp')) return 'whatsapp';
      return 'telegram';
    }

    function setPlatform(platform) {
      activePlatform = normalizePlatformKey(platform);
      localStorage.setItem('acd_platform_v6', activePlatform);
      updatePlatformUI();
      renderStats();
      renderHome();
      if (document.getElementById('p-produtos')?.classList.contains('active')) filterTbl();
      if (document.getElementById('p-historico')?.classList.contains('active')) filterHistorico();
      toast(`Gerenciador ativo: ${platformLabel()}`, 'ok');
    }

    function updatePlatformUI() {
      document.querySelectorAll('[data-platform-chip]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.platformChip === activePlatform);
      });
      const hp = document.getElementById('h-platform');
      if (hp) hp.value = activePlatform === 'ambos' ? '' : platformLabel(activePlatform);
    }

    // -- TEMA --
    function updateThemeButton(theme = document.documentElement.getAttribute('data-theme') || 'light') {
      const btn = document.getElementById('btn-theme');
      if (!btn) return;
      const isDark = theme === 'dark';
      btn.title = isDark ? 'Ativar tema claro' : 'Ativar tema escuro';
      btn.setAttribute('aria-pressed', String(isDark));
      btn.classList.toggle('is-dark', isDark);
    }
    function applyTheme(theme) {
      const next = theme === 'dark' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('acd_theme_v5', next);
      updateThemeButton(next);
    }
    function initTheme() { applyTheme(localStorage.getItem('acd_theme_v5') || 'light'); }
    function toggleTheme() { const c = document.documentElement.getAttribute('data-theme'); const n = c === 'dark' ? 'light' : 'dark'; applyTheme(n); addLog(`Tema: ${n}`, 'info'); }
    initTheme();

    // -- INFRA & UTILS --
    function normalizeBotUrl(value) {
      const raw = String(value || '').trim().replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\/+$/, '');
      if (!raw) return '';
      if (!/^https:\/\//i.test(raw)) {
        throw new Error('A URL do Bot deve começar obrigatoriamente com https://');
      }
      return raw;
    }

    function getCfg() {
      try {
        const saved = JSON.parse(localStorage.getItem(CK) || '{}');
        return { ...DCFG, ...saved };
      } catch (e) {
        return DCFG;
      }
    }

    function sCfg(c) {
      const clean = { ...c };
      if (clean.botUrl) clean.botUrl = normalizeBotUrl(clean.botUrl);
      localStorage.setItem(CK, JSON.stringify(clean));
    }

    function getBotBaseUrl() {
      const c = getCfg();
      if (!c.botUrl) throw new Error('A URL do Bot não está configurada na aba de Configurações.');
      return normalizeBotUrl(c.botUrl);
    }

    function describeFetchError(err) {
      if (err?.name === 'AbortError') {
        return 'Tempo esgotado. O bot pode estar offline ou hibernando na Discloud.';
      }
      if ((err?.message || '').includes('Failed to fetch') || (err?.message || '').includes('NetworkError')) {
        return 'Erro de conexão (Failed to fetch). Verifique se a URL usa https://, se o app está Running na Discloud e se o CORS foi publicado no redeploy.';
      }
      return err?.message || String(err);
    }

    function toast(msg, type = 'ok') {
      const el = document.getElementById('toast'); if (!el) return;
      const icons = { ok: '✅', err: '❌', warn: '⚠️' };
      el.innerHTML = `${icons[type] || 'ℹ️'} ${msg}`;
      el.className = `show ${type}`;
      clearTimeout(_tt); _tt = setTimeout(() => { el.className = '' }, 4500);
    }

    function addLog(msg, type = 'info') {
      const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      logEntries.unshift({ time: now, msg, type });
      if (logEntries.length > 120) logEntries.pop();
      renderLog();
    }
    function renderLog() {
      const body = document.getElementById('log-body'), count = document.getElementById('log-count');
      if (!body) return;
      body.innerHTML = logEntries.map(e => `<div class="log-line"><span class="log-time">[${e.time}]</span><span class="log-msg ${e.type}">${e.msg}</span></div>`).join('');
      if (count) count.textContent = `${logEntries.length} linhas`;
    }
    function clearLog() { logEntries = []; renderLog(); toast('Buffer limpo.') }

    async function fetchWithTimeout(resource, options = {}) {
      const { timeout = 20000, ...fetchOptions } = options;
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), timeout);
      try {
        return await fetch(resource, { redirect: 'follow', ...fetchOptions, signal: ctrl.signal });
      } finally {
        clearTimeout(id);
      }
    }

    // -- COMUNICAÇÃO API --
    async function apiGet(params) {
      const c = getCfg();
      if (!c.scriptUrl) throw new Error("URL do Apps Script não configurada.");
      const u = new URL(String(c.scriptUrl).trim());
      u.searchParams.set('key', authTok || c.pass);
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) u.searchParams.set(k, v);
      });
      const r = await fetchWithTimeout(u.toString(), { cache: 'no-store' });
      const text = await r.text();
      try { return JSON.parse(text); }
      catch (_) { throw new Error(text ? `Retorno não-JSON: ${text.slice(0, 120)}` : `HTTP ${r.status} sem corpo`); }
    }

    async function apiPost(body) {
      const c = getCfg();
      if (!c.scriptUrl) throw new Error("URL do Apps Script não configurada.");
      const payload = { ...body, key: authTok || c.pass };
      const r = await fetchWithTimeout(c.scriptUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });
      if (r.type === 'opaque') return { status: 'sucesso' };
      return r.json();
    }

    async function botFetch(ep, params = {}, method = 'POST') {
      const c = getCfg();
      const base = getBotBaseUrl();

      try {
        const r = await fetchWithTimeout(`${base}${ep}`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...params, secret: c.secret }),
          timeout: 25000,
        });
        if (!r.ok) {
          let detail = `HTTP ${r.status}`;
          try {
            const ed = await r.json();
            detail = Array.isArray(ed.detail) ? ed.detail.map(e => `[${(e.loc || []).join('.')}] ${e.msg}`).join(' | ') : (ed.detail || detail);
          } catch (e) { }
          throw new Error(detail);
        }
        return await r.json();
      } catch (err) {
        const detail = describeFetchError(err);
        addLog(`Falha API Bot [${ep}]: ${detail}`, 'err');
        throw new Error(detail);
      }
    }

    // -- AUTH & INICIALIZAÇÃO --
    async function doLogin() {
      const em = document.getElementById('l-email').value.trim(), pw = document.getElementById('l-pass').value;
      const sp = document.getElementById('l-spin'), er = document.getElementById('l-err'), btn = document.getElementById('btn-login');
      er.style.display = 'none'; sp.classList.add('on'); btn.disabled = true;

      const setupVisible = document.getElementById('l-setup').style.display !== 'none';
      if (setupVisible) {
        const scriptUrl = document.getElementById('l-script').value.trim();
        const rawBotUrl = document.getElementById('l-bot').value;
        const secret = document.getElementById('l-secret').value;
        let botUrl = '';
        try { botUrl = rawBotUrl ? normalizeBotUrl(rawBotUrl) : ''; }
        catch (e) {
          er.textContent = e.message; er.style.display = 'block';
          sp.classList.remove('on'); btn.disabled = false; return;
        }
        if (!scriptUrl || !em || !pw) {
          er.textContent = 'Preencha a URL do Apps Script, e-mail e senha.'; er.style.display = 'block';
          sp.classList.remove('on'); btn.disabled = false; return;
        }
        sCfg({ ...getCfg(), scriptUrl, botUrl, email: em, pass: pw, secret });
      }

      const cfg = getCfg();

      if (!cfg.scriptUrl) {
        er.textContent = 'Configure a URL do Apps Script antes de logar.'; er.style.display = 'block';
        sp.classList.remove('on'); btn.disabled = false; return;
      }

      if (em === cfg.email && pw === cfg.pass && em) {
        try {
          await fetchWithTimeout(cfg.scriptUrl, {
            method: 'POST', mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'login', email: em, password: pw, key: cfg.pass }),
          });
        } catch (_) { }
        authTok = cfg.pass; localStorage.setItem('acd_auth_v5', authTok); boot();
      } else {
        er.textContent = 'Credenciais inválidas.'; er.style.display = 'block';
        sp.classList.remove('on'); btn.disabled = false;
      }
    }

    function doLogout() { authTok = null; localStorage.removeItem('acd_auth_v5'); document.getElementById('login-screen').style.cssText = 'display:flex;opacity:1'; document.getElementById('app').style.display = 'none'; }

    function boot() {
      document.getElementById('login-screen').style.opacity = '0';
      setTimeout(() => {
        document.getElementById('login-screen').style.display = 'none'; document.getElementById('app').style.display = 'flex';
        loadCfgUI(); updatePlatformUI(); addLog('Sistema inicializado.', 'ok');
        loadAll(); checkBot();
      }, 380);
    }

    function goTo(id) {
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.getElementById('p-' + id).classList.add('active');
      const nav = document.querySelector(`.nav-item[data-panel="${id}"]`); if (nav) nav.classList.add('active');
      const meta = PANEL_META[id] || { title: id, icon: '•' };
      document.getElementById('ptitle').textContent = meta.title; document.getElementById('p-icon').textContent = meta.icon;
      if (id !== 'inicio') closeProductPreview();
      else hideProductContext();
      if (id === 'produtos') filterTbl(false);
      if (id === 'historico') loadHistorico();
      if (id === 'atividade') refreshStatus();
    }

    // -- CARREGAMENTO PRINCIPAL --
    async function loadAll(force = false) {
      if (_loadAllPromise && !force) return _loadAllPromise;
      _loadAllPromise = loadAllInternal(force);
      try {
        return await _loadAllPromise;
      } finally {
        _loadAllPromise = null;
      }
    }

    async function loadAllInternal(force = false) {
      const btn = document.getElementById('btn-refresh');
      const sync = document.getElementById('last-sync');
      if (btn) btn.disabled = true;

      if (force) clearManageProductsCache();
      const cached = force ? null : readManageProductsCache();
      let usingCache = false;

      if (cached?.data?.length) {
        prods = cached.data.map(normalizeProductRow);
        indexProducts();
        renderStats(); renderHome(); updateBadges();
        if (document.getElementById('p-produtos')?.classList.contains('active')) filterTbl(false);
        if (sync) sync.textContent = `Cache: ${new Date(cached.savedAt).toLocaleTimeString('pt-BR')}`;
        usingCache = true;

        if (!cached.stale) {
          if (btn) btn.disabled = false;
          loadCrons().catch(e => addLog(`Erro ao carregar crons: ${e.message}`, 'warn'));
          return;
        }
      }

      try {
        const j = await apiGet({ action: 'listar', _ts: Date.now() });
        const lista = extractProductList(j);

        if (!lista) {
          const detalhe = j?.mensagem || j?.erro || j?.status || 'resposta sem produtos';
          throw new Error(`Resposta inválida do Apps Script: ${detalhe}`);
        }

        prods = lista.map(normalizeProductRow);
        indexProducts();
        saveManageProductsCache(prods);
        renderStats(); renderHome(); updateBadges();
        if (document.getElementById('p-produtos')?.classList.contains('active')) filterTbl(false);
        if (sync) sync.textContent = `Sincronizado: ${new Date().toLocaleTimeString('pt-BR')}`;
        addLog(`DB sincronizado — ${prods.length} produtos.`, 'ok');
        await loadCrons();
      } catch (e) {
        addLog(`Erro sincronização: ${e.message}`, 'err');
        toast(usingCache ? 'Mostrando cache local. Sync falhou.' : `Erro ao buscar planilha: ${e.message}`, usingCache ? 'warn' : 'err');
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    function extractProductList(response) {
      if (Array.isArray(response)) return response;
      if (Array.isArray(response?.produtos)) return response.produtos;
      if (Array.isArray(response?.data)) return response.data;
      if (Array.isArray(response?.items)) return response.items;
      return null;
    }

    function normalizeProductRow(row = {}) {
      const sem = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      const flat = {};
      Object.keys(row || {}).forEach(k => flat[sem(k)] = row[k]);
      const pick = (...keys) => {
        for (const k of keys) {
          const direct = row[k];
          if (direct !== undefined && direct !== null && direct !== '') return direct;
          const norm = flat[sem(k)];
          if (norm !== undefined && norm !== null && norm !== '') return norm;
        }
        return '';
      };

      return {
        ...row,
        ID: pick('ID', 'Id', 'id'),
        Data: pick('Data'),
        Link: pick('Link'),
        Título: pick('Título', 'Titulo', 'titulo'),
        Preço: pick('Preço', 'Preco', 'preco'),
        Imagem: pick('Imagem', 'image', 'imagem'),
        ShopId: pick('ShopId', 'shopId'),
        ItemId: pick('ItemId', 'itemId'),
        Status: pick('Status') || 'pendente',
        Comentário: pick('Comentário', 'Comentario') || '',
        Categoria: pick('Categoria') || '',
        Prioridade: pick('Prioridade') || 'média',
        Estoque: pick('Estoque') || '',
        UltimaVerif: pick('UltimaVerif', 'ÚltimaVerif', 'Ultima Verif') || '',
        EnvTelegram: pick('EnvTelegram') || 'pendente',
        EnvWhatsapp: pick('EnvWhatsapp', 'EnvWhatsApp', 'EnvZap', 'EnvWA') || 'pendente',
        Urgente: pick('Urgente') || 'nao',
        DescontoAleatorio: pick('DescontoAleatorio') || 'nao'
      };
    }

    function indexProducts() {
      productById = new Map();
      prods.forEach(p => {
        if (p?.ID !== undefined && p.ID !== null && p.ID !== '') productById.set(String(p.ID), p);
      });
    }

    function findProductById(id) {
      return productById.get(String(id)) || prods.find(x => String(x.ID) === String(id));
    }

    function renderStats() {
      const field = platformField();
      const pLabel = platformLabel();
      document.getElementById('s-tot').textContent = prods.length;
      if (activePlatform === 'ambos') {
        document.getElementById('s-fei').textContent = prods.filter(p => p.EnvTelegram === 'feito' || p.EnvWhatsapp === 'feito').length;
        document.getElementById('s-pen').textContent = prods.filter(p => p.EnvTelegram === 'pendente' || (p.EnvWhatsapp || 'pendente') === 'pendente').length;
      } else {
        document.getElementById('s-fei').textContent = prods.filter(p => p[field] === 'feito').length;
        document.getElementById('s-pen').textContent = prods.filter(p => (p[field] || 'pendente') === 'pendente').length;
      }
      document.getElementById('s-site').textContent = prods.filter(p => p.Status === 'feito' || p.Status === 'sim').length;
      const feiLabel = document.getElementById('s-fei-label'), penLabel = document.getElementById('s-pen-label');
      if (feiLabel) feiLabel.textContent = `Enviados (${pLabel})`;
      if (penLabel) penLabel.textContent = `Pendentes (${pLabel})`;
    }

    function updateBadges() {
      const pen = prods.filter(p => p.EnvTelegram === 'pendente' || (p.EnvWhatsapp || 'pendente') === 'pendente').length;
      const nb = document.getElementById('nb-pend');
      if (pen > 0) { nb.textContent = pen; nb.style.display = 'block' } else nb.style.display = 'none';
    }

    function sb(s, label = '') {
      const status = String(s || 'pendente').toLowerCase();
      const statusTxt = { feito: 'enviado', pendente: 'pendente', pausado: 'pausado', erro: 'erro' }[status] || status;
      const statusCls = { feito: 'b-done', pendente: 'b-pend', pausado: 'b-pau', erro: 'b-no' }[status] || 'b-pend';
      const labelKey = String(label || '').toLowerCase();
      const platformCls = labelKey.includes('whatsapp') ? 'b-wa' : (labelKey.includes('telegram') ? 'b-tg' : statusCls);
      const short = labelKey.includes('whatsapp') ? 'WA' : (labelKey.includes('telegram') ? 'TG' : '');
      return `<span class="badge ${platformCls}" title="${label || 'status'}: ${statusTxt}">${short ? short + ' · ' : ''}${statusTxt}</span>`;
    }
    function siteb(s) { return (s === 'sim' || s === 'feito') ? '<span class="badge b-pub">Site · visível</span>' : '<span class="badge b-pau">Site · oculto</span>' }
    function fp(p) { const n = parseFloat(p); return isNaN(n) ? String(p || '') : 'R$ ' + n.toFixed(2).replace('.', ',') }
    function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
    function attr(s) { return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;') }
    function svgIcon(name) {
      const icons = {
        send: '<path d="M22 2 11 13"></path><path d="m22 2-7 20-4-9-9-4Z"></path>',
        flame: '<path d="M8.5 14.5A4.5 4.5 0 0 0 12 22a4.5 4.5 0 0 0 4.5-7.5c-.6-.7-1.1-1.5-1-2.5-1 .8-2.2 1.2-3.5 1-2-.3-3.2-1.7-3.5-4.5-2 1.7-3 3.7-3 6Z"></path><path d="M12 22a2.6 2.6 0 0 0 2.1-4.1c-.4.3-.9.5-1.5.5-1 0-1.7-.6-2-1.7-.8.8-1.2 1.6-1.2 2.5A2.6 2.6 0 0 0 12 22Z"></path>',
        edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>',
        link: '<path d="M10 13a5 5 0 0 0 7.54.54l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.15"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-2 2a5 5 0 0 0 7.07 7.07l1.15-1.15"></path>',
        plus: '<path d="M12 5v14"></path><path d="M5 12h14"></path>',
        close: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
        refresh: '<path d="M20 7v5h-5"></path><path d="M20 12a8 8 0 1 1-2.35-5.66L20 8"></path>',
        trash: '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 16H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path>',
        play: '<path d="m8 5 11 7-11 7Z"></path>',
        arrowLeft: '<path d="M19 12H5"></path><path d="m11 18-6-6 6-6"></path>',
        arrowRight: '<path d="M5 12h14"></path><path d="m13 6 6 6-6 6"></path>',
        save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"></path><path d="M17 21v-8H7v8"></path><path d="M7 3v5h8"></path>',
        plug: '<path d="M12 22v-5"></path><path d="M8 7V2"></path><path d="M16 7V2"></path><path d="M6 7h12v5a6 6 0 0 1-12 0Z"></path>'
      };
      return `<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.plus}</svg>`;
    }

    function clampPage(page, totalPages) {
      return Math.min(Math.max(Number(page) || 1, 1), Math.max(totalPages, 1));
    }

    function visiblePages(current, totalPages) {
      if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
      const pages = new Set([1, totalPages, current, current - 1, current + 1]);
      if (current <= 3) [2, 3, 4].forEach(p => pages.add(p));
      if (current >= totalPages - 2) [totalPages - 3, totalPages - 2, totalPages - 1].forEach(p => pages.add(p));
      return [...pages].filter(p => p >= 1 && p <= totalPages).sort((a, b) => a - b);
    }

    function renderPagination(targetId, total, page, onPageFn, label = 'itens') {
      const el = document.getElementById(targetId);
      if (!el) return;
      const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      const safePage = clampPage(page, totalPages);
      const start = total ? ((safePage - 1) * PAGE_SIZE) + 1 : 0;
      const end = Math.min(safePage * PAGE_SIZE, total);

      if (!total) {
        el.innerHTML = '';
        return;
      }

      const pages = visiblePages(safePage, totalPages);
      let last = 0;
      const pageButtons = pages.map(p => {
        const gap = p - last > 1 ? '<span class="pager-ellipsis">...</span>' : '';
        last = p;
        return `${gap}<button class="pager-btn ${p === safePage ? 'active' : ''}" ${p === safePage ? 'disabled' : ''} onclick="${onPageFn}(${p})">${p}</button>`;
      }).join('');

      el.innerHTML = `
        <div class="pager-summary">
          <strong>${start}-${end}</strong> de ${total} ${label}
          <span>50 por pagina</span>
        </div>
        <div class="pager-controls">
          <button class="pager-btn pager-nav" ${safePage <= 1 ? 'disabled' : ''} onclick="${onPageFn}(${safePage - 1})">${svgIcon('arrowLeft')} Anterior</button>
          <div class="pager-pages">${pageButtons}</div>
          <button class="pager-btn pager-nav" ${safePage >= totalPages ? 'disabled' : ''} onclick="${onPageFn}(${safePage + 1})">Proxima ${svgIcon('arrowRight')}</button>
        </div>`;
    }

    function scrollPanelList(id) {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // -- INVENTÁRIO & DASHBOARD --
    function renderHome() {
      const activeField = platformField();
      const tb = document.getElementById('home-tbl');
      const items = prods.filter(p => activePlatform === 'ambos'
        ? (p.EnvTelegram === 'pendente' || (p.EnvWhatsapp || 'pendente') === 'pendente')
        : ((p[activeField] || 'pendente') === 'pendente')).slice(0, 6);

      if (!items.length) {
        tb.innerHTML = '<div class="empty"><div class="eico">🎉</div>Nenhum pendente no modo atual</div>';
        return;
      }

      tb.innerHTML = items.map(p => {
        const isUrg = String(p.Urgente || '').toLowerCase() === 'sim';
        const image = p.Imagem
          ? `<img class="queue-img" src="${esc(p.Imagem)}" loading="lazy" decoding="async" onerror="this.outerHTML='<div class=&quot;queue-img&quot; style=&quot;display:grid;place-items:center;font-size:24px&quot;>🛍️</div>'">`
          : `<div class="queue-img" style="display:grid;place-items:center;font-size:24px">🛍️</div>`;
        const safeId = attr(p.ID || '');
        return `<div class="queue-card" role="button" tabindex="0" onclick="openProductPreview('${safeId}', event)" oncontextmenu="openProductContext('${safeId}', event)" onkeydown="if(event.key==='Enter'||event.key===' '){openProductPreview('${safeId}', event)}">
          ${image}
          <div class="queue-info">
            <div class="queue-name">${esc(p.Título)}</div>
            <div class="queue-meta">
              <span class="price">${fp(p.Preço)}</span>
              <span class="badge b-pau">${esc(p.Categoria || 'Geral')}</span>
              ${sb(p.EnvTelegram, 'Telegram')}
              ${sb(p.EnvWhatsapp || 'pendente', 'WhatsApp API')}
              ${isUrg ? '<span class="badge b-urg">URGENTE</span>' : ''}
            </div>
          </div>
          <div class="queue-actions">
            <button class="ib${isUrg ? ' ib-urg' : ''}" title="${isUrg ? 'Desmarcar urgente' : 'Marcar urgente'}" onclick="event.stopPropagation();toggleUrgente('${safeId}', this)">${svgIcon('flame')}</button>
            <button class="ib" title="Enviar agora em ${platformLabel()}" onclick="event.stopPropagation();qSend('${safeId}', this)">${svgIcon('send')}</button>
          </div>
        </div>`;
      }).join('');
    }

    function renderProds(list) {
      productView = Array.isArray(list) ? list : [];
      const wrap = document.getElementById('prod-tbl');
      const total = productView.length;
      const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      productPage = clampPage(productPage, totalPages);
      const startIndex = (productPage - 1) * PAGE_SIZE;
      const pageItems = productView.slice(startIndex, startIndex + PAGE_SIZE);
      const count = document.getElementById('q-count');
      if (count) {
        const start = total ? startIndex + 1 : 0;
        const end = Math.min(startIndex + PAGE_SIZE, total);
        count.textContent = total ? `${total} registros | ${start}-${end}` : '0 registros';
      }

      if (!total) {
        wrap.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="eico">📭</div>Nada encontrado.</div>';
        renderPagination('prod-pagination', 0, productPage, 'setProductPage', 'produtos');
        return;
      }

      wrap.innerHTML = pageItems.map((p, index) => {
        const isUrg = String(p.Urgente || '').toLowerCase() === 'sim';
        const img = p.Imagem ? `<img class="inv-img" src="${esc(p.Imagem)}" loading="lazy" decoding="async" onerror="this.outerHTML='<div class=&quot;inv-img-ph&quot;>🛍️</div>'">` : `<div class="inv-img-ph">🛍️</div>`;
        const safeId = attr(p.ID || '');
        const idShort = esc(String(p.ID || '').substring(0, 8) || '—');
        const shop = esc(p.ShopId || '—');
        const item = esc(p.ItemId || '—');
        const comentario = esc(p['Comentário'] || 'Sem observações.');
        const data = esc(p.Data || '—');
        const link = p.Link ? `<a class="btn btn-ghost btn-sm btn-icon-soft" href="${esc(p.Link)}" target="_blank" rel="noopener" title="Abrir link da oferta">${svgIcon('link')} Link</a>` : `<button class="btn btn-ghost btn-sm btn-icon-soft" disabled>${svgIcon('link')} Link</button>`;
        return `<div class="inv-card" style="--i:${Math.min(index, 12)}">
          <div class="inv-img-wrap">${img}</div>
          <div class="inv-body">
            <div class="inv-topline">
              <div class="inv-title">${esc(p.Título)}</div>
              <div class="inv-price">${fp(p.Preço)}</div>
            </div>
            <div class="inv-badges">
              ${sb(p.EnvTelegram, 'Telegram')}
              ${sb(p.EnvWhatsapp || 'pendente', 'WhatsApp API')}
              ${siteb(p.Status)}
              ${isUrg ? '<span class="badge b-urg">URGENTE</span>' : ''}
              <span class="badge b-pau">${esc(p.Categoria || 'Geral')}</span>
            </div>
            <div class="inv-meta-grid">
              <div class="inv-meta"><span class="inv-meta-l">Produto</span><span class="inv-meta-v">#${idShort}</span></div>
              <div class="inv-meta"><span class="inv-meta-l">Data</span><span class="inv-meta-v">${data}</span></div>
              <div class="inv-meta"><span class="inv-meta-l">Shop</span><span class="inv-meta-v">${shop}</span></div>
              <div class="inv-meta"><span class="inv-meta-l">Item</span><span class="inv-meta-v">${item}</span></div>
            </div>
            <div class="inv-note">${comentario}</div>
            <div class="inv-actions">
              <button class="btn btn-green btn-sm" onclick="qSend('${safeId}', this)" title="Enviar em ${platformLabel()}">${svgIcon('send')} Enviar</button>
              <button class="btn btn-ghost btn-sm ${isUrg ? 'ib-urg' : ''}" onclick="toggleUrgente('${safeId}', this)" title="Alternar prioridade urgente">${svgIcon('flame')} ${isUrg ? 'Urgente' : 'Prioridade'}</button>
              <button class="btn btn-ghost btn-sm btn-icon-soft" onclick="openEdit('${safeId}')">${svgIcon('edit')} Editar</button>
              ${link}
            </div>
          </div>
        </div>`;
      }).join('');
      renderPagination('prod-pagination', total, productPage, 'setProductPage', 'produtos');
    }

    function setProductPage(page) {
      productPage = page;
      renderProds(productView);
      scrollPanelList('prod-tbl');
    }

    function filterTbl(resetPage = true) {
      if (resetPage) productPage = 1;
      const qInput = document.getElementById('q-s');
      const globalInput = document.getElementById('global-search');
      if (globalInput && qInput && globalInput.value !== qInput.value) globalInput.value = qInput.value;
      const q = normalizeSearchText(qInput.value), st = document.getElementById('q-st').value, siteSt = document.getElementById('q-site').value;
      const matchesPlatform = (p) => {
        if (!st) return true;
        if (activePlatform === 'ambos') return p.EnvTelegram === st || (p.EnvWhatsapp || 'pendente') === st;
        return (p[platformField()] || 'pendente') === st;
      };
      renderProds(prods.filter(p => normalizeSearchText(p.Título).includes(q) && matchesPlatform(p) && (!siteSt || (siteSt === 'feito' ? (p.Status === 'sim' || p.Status === 'feito') : (p.Status !== 'sim' && p.Status !== 'feito')))));
    }

    function applyGlobalSearch() {
      const globalInput = document.getElementById('global-search');
      const qInput = document.getElementById('q-s');
      const value = globalInput?.value || '';
      if (qInput && qInput.value !== value) qInput.value = value;
      if (value.trim() && !document.getElementById('p-produtos')?.classList.contains('active')) {
        goTo('produtos');
        return;
      }
      if (document.getElementById('p-produtos')?.classList.contains('active')) filterTbl(true);
    }

    function productImageHtml(p, cls = 'preview-img') {
      return p?.Imagem
        ? `<img class="${cls}" src="${esc(p.Imagem)}" loading="lazy" decoding="async" onerror="this.outerHTML='<div class=&quot;${cls}-ph&quot;>🛍️</div>'">`
        : `<div class="${cls}-ph">🛍️</div>`;
    }

    function openProductPreview(id, event) {
      if (!document.getElementById('p-inicio')?.classList.contains('active')) return;
      if (event?.target?.closest?.('button,a,input,select,textarea')) return;
      event?.preventDefault?.();
      event?.stopPropagation?.();
      const p = findProductById(id);
      if (!p) return;
      previewProductId = String(id);
      renderProductPreview(p);
      document.getElementById('product-preview')?.classList.add('open');
      hideProductContext();
    }

    function openProductContext(id, event) {
      if (!document.getElementById('p-inicio')?.classList.contains('active')) return;
      if (event?.target?.closest?.('button,a,input,select,textarea')) return;
      event?.preventDefault?.();
      event?.stopPropagation?.();
      showProductContext(id, event);
    }

    function closeProductPreview() {
      previewProductId = null;
      document.getElementById('product-preview')?.classList.remove('open');
      hideProductContext();
    }

    function renderProductPreview(p) {
      const title = document.getElementById('pv-title');
      const body = document.getElementById('pv-body');
      if (!title || !body || !p) return;
      const safeId = attr(p.ID || '');
      const isUrg = String(p.Urgente || '').toLowerCase() === 'sim';
      title.textContent = p.Título || 'Produto';
      body.innerHTML = `
        <div class="preview-media">${productImageHtml(p)}</div>
        <div class="preview-main">
          <div class="preview-price-row">
            <strong>${fp(p.Preço)}</strong>
            <span class="badge ${isUrg ? 'b-urg' : 'b-pau'}">${isUrg ? 'Urgente' : esc(p.Prioridade || 'Prioridade')}</span>
          </div>
          <div class="preview-name">${esc(p.Título || 'Produto sem título')}</div>
          <div class="preview-badges">
            ${sb(p.EnvTelegram, 'Telegram')}
            ${sb(p.EnvWhatsapp || 'pendente', 'WhatsApp API')}
            ${siteb(p.Status)}
            <span class="badge b-pau">${esc(p.Categoria || 'Geral')}</span>
          </div>
          <div class="preview-actions">
            <button class="btn btn-green btn-full" onclick="qSend('${safeId}', this)">${svgIcon('send')} Enviar agora</button>
            <button class="btn btn-ghost btn-full ${isUrg ? 'ib-urg' : ''}" onclick="toggleUrgente('${safeId}', this)">${svgIcon('flame')} ${isUrg ? 'Remover urgência' : 'Marcar urgente'}</button>
            <button class="btn btn-ghost btn-full" onclick="openEdit('${safeId}')">${svgIcon('edit')} Editar dados</button>
            ${p.Link ? `<a class="btn btn-ghost btn-full" href="${esc(p.Link)}" target="_blank" rel="noopener">${svgIcon('link')} Abrir oferta</a>` : `<button class="btn btn-ghost btn-full" disabled>${svgIcon('link')} Sem link</button>`}
          </div>
          <div class="preview-detail-grid">
            <div><span>ID</span><strong>#${esc(String(p.ID || '').substring(0, 12) || '—')}</strong></div>
            <div><span>Data</span><strong>${esc(p.Data || '—')}</strong></div>
            <div><span>Shop</span><strong>${esc(p.ShopId || '—')}</strong></div>
            <div><span>Item</span><strong>${esc(p.ItemId || '—')}</strong></div>
            <div><span>Estoque</span><strong>${esc(p.Estoque || '—')}</strong></div>
            <div><span>Última verificação</span><strong>${esc(p.UltimaVerif || '—')}</strong></div>
          </div>
          <div class="preview-note">
            <span>Notas internas</span>
            <p>${esc(p.Comentário || p['Comentário'] || 'Sem observações.')}</p>
          </div>
        </div>`;
    }

    function showProductContext(id, event) {
      const menu = document.getElementById('product-context');
      if (!menu || !event?.clientX) return;
      const p = findProductById(id);
      if (!p) return;
      const safeId = attr(id);
      const isUrg = String(p.Urgente || '').toLowerCase() === 'sim';
      menu.innerHTML = `
        <button onclick="event.stopPropagation();qSend('${safeId}', null);hideProductContext()">${svgIcon('send')} Enviar</button>
        <button onclick="event.stopPropagation();toggleUrgente('${safeId}', null);hideProductContext()">${svgIcon('flame')} ${isUrg ? 'Remover urgência' : 'Urgente'}</button>
        <button onclick="event.stopPropagation();openEdit('${safeId}');hideProductContext()">${svgIcon('edit')} Editar</button>
        ${p.Link ? `<a href="${esc(p.Link)}" target="_blank" rel="noopener" onclick="event.stopPropagation();hideProductContext()">${svgIcon('link')} Abrir link</a>` : ''}
      `;
      menu.classList.add('open');
      menu.setAttribute('aria-hidden', 'false');
      const pad = 14;
      const rectWidth = 190;
      const left = Math.min(event.clientX + 12, window.innerWidth - rectWidth - pad);
      const top = Math.min(event.clientY + 12, window.innerHeight - 190);
      menu.style.left = `${Math.max(pad, left)}px`;
      menu.style.top = `${Math.max(pad, top)}px`;
    }

    function hideProductContext() {
      const menu = document.getElementById('product-context');
      if (!menu) return;
      menu.classList.remove('open');
      menu.setAttribute('aria-hidden', 'true');
    }

    function refreshProductViews(resetPage = false) {
      renderStats();
      renderHome();
      updateBadges();
      if (document.getElementById('p-produtos')?.classList.contains('active')) filterTbl(resetPage);
      if (previewProductId) {
        const p = findProductById(previewProductId);
        if (p) renderProductPreview(p);
      }
    }

    function applyProductSendLocally(product, selected, results = {}) {
      if (!product) return;
      const platform = normalizePlatformKey(selected);
      const platforms = platform === 'ambos' ? ['telegram', 'whatsapp'] : [platform];
      platforms.forEach(pf => {
        const result = results[pf];
        product[platformField(pf)] = result && result.ok === false ? 'erro' : 'feito';
      });
      saveManageProductsCache(prods);
      refreshProductViews(false);
      _historyLoadedAt = 0;
    }

    function scheduleProductSync(delay = 1800) {
      clearTimeout(_productSyncTimer);
      _productSyncTimer = setTimeout(() => {
        loadAll(true).catch(e => addLog(`Sync em segundo plano falhou: ${e.message}`, 'warn'));
      }, delay);
    }

    // -- TOGGLE URGENTE --
    async function toggleUrgente(id, btnEl) {
      const p = findProductById(id);
      if (!p) return;

      const novoEstado = String(p.Urgente || '').toLowerCase() !== 'sim';
      if (btnEl) btnEl.disabled = true;

      try {
        await apiPost({
          action: 'atualizar',
          id,
          campos: { Urgente: novoEstado ? 'sim' : 'nao' }
        });

        try {
          await botFetch('/marcar-urgente', { id, urgente: novoEstado });
        } catch (_) { }

        p.Urgente = novoEstado ? 'sim' : 'nao';
        saveManageProductsCache(prods);

        toast(
          novoEstado ? '🔥 Produto marcado como URGENTE — será priorizado na fila!' : '✅ Urgência removida do produto.',
          novoEstado ? 'warn' : 'ok'
        );
        addLog(`Urgente=${novoEstado ? 'sim' : 'nao'} → produto ${id}`, novoEstado ? 'warn' : 'info');

        refreshProductViews(false);

      } catch (e) {
        toast('Erro ao atualizar urgência: ' + e.message, 'err');
      } finally {
        if (btnEl) btnEl.disabled = false;
      }
    }

    // -- CRONS (AUTOMAÇÃO) --
    async function loadCrons(force = false) {
      if (!force && _cronsLoadedAt && Date.now() - _cronsLoadedAt < CRON_CACHE_TTL) {
        renderCrons();
        return;
      }
      if (_cronPromise && !force) return _cronPromise;

      _cronPromise = (async () => {
        try {
          const j = await apiGet({ action: 'listar_crons' });
          if (j.status === 'sucesso') {
            cronData = j.crons || [];
            _cronsLoadedAt = Date.now();
            renderCrons();
          }
        } catch (e) {
          console.error("Erro ao carregar crons", e);
        } finally {
          _cronPromise = null;
        }
      })();
      return _cronPromise;
    }

    function renderCrons() {
      const homeList = document.getElementById('home-crons-list');
      if (homeList) {
        if (cronData.length === 0) homeList.innerHTML = '<div style="font-size:12px;color:var(--text3);text-align:center;padding:10px">Nenhum cron cadastrado.</div>';
        else homeList.innerHTML = cronData.map(c => `<div class="sitem"><div><div class="time-input" style="display:inline-block;border:none;padding:0;font-weight:bold;font-size:16px">${esc(c.Horario || '—')}</div><div style="font-size:10px;color:var(--text3);font-weight:800;text-transform:uppercase;margin-top:2px">${platformLabel(cronPlatformValue(c.Plataformas))}</div></div><span class="badge ${c.Ativo === 'sim' ? 'b-done' : 'b-pau'}">${c.Ativo === 'sim' ? 'Ativo' : 'Pausado'}</span></div>`).join('');
      }

      const grid = document.getElementById('cron-grid');
      if (!grid) return;

      if (cronData.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1"><div class="empty"><div class="eico">⏰</div>Nenhum agendamento.</div></div>';
        return;
      }

      grid.innerHTML = cronData.map(c => {
        const ativo = String(c.Ativo || '').toLowerCase() === 'sim';
        const hasTemplate = !!String(c.Template || '').trim();
        const hasImagem = !!String(c.Imagem || '').trim();
        const safeId = attr(c.ID || '');
        const imgPreview = hasImagem ? driveUrl(c.Imagem) : '';
        const cronPlat = cronPlatformValue(c.Plataformas);
        return `<div class="cron-card">
          <div class="cron-card-header">
            <div>
              <div class="cron-time">⏰ ${esc(c.Horario || '—')}</div>
              <div style="font-size:11px;color:var(--text3);font-family:var(--mono);margin-top:3px">ID: ${esc(c.ID || '—')}</div>
            </div>
            <span class="badge ${ativo ? 'b-done' : 'b-pau'}">${ativo ? 'Ativo' : 'Pausado'}</span>
          </div>
          ${imgPreview ? `<div style="border-radius:var(--r);overflow:hidden;margin-bottom:8px;max-height:110px;border:1px solid var(--border)"><img src="${attr(imgPreview)}" alt="imagem fixa" style="width:100%;height:110px;object-fit:cover;display:block" onerror="this.parentElement.style.display='none'"></div>` : ''}
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
            <span class="badge ${hasTemplate ? 'b-pub' : 'b-pau'}">${hasTemplate ? 'Template próprio' : 'Template base'}</span>
            ${hasImagem ? '<span class="badge b-pub">Imagem fixa</span>' : ''}
            <span class="badge b-wa">${platformLabel(cronPlat)}</span>
          </div>
          <div class="cron-tmpl-preview">${hasTemplate ? esc(c.Template) : '<i>Usará o template base do bot</i>'}</div>
          <div style="display:grid;grid-template-columns:1.2fr 1fr auto;gap:8px;margin-top:10px">
            <button class="btn btn-green btn-sm btn-full" id="btn-disp-${safeId}" onclick="dispararCronAgora('${safeId}')" ${ativo ? '' : 'disabled title="Ative o cron para disparar manualmente"'}>${svgIcon('play')} Disparar agora</button>
            <button class="btn btn-ghost btn-sm btn-full" onclick="openCronModal('${safeId}')">${svgIcon('edit')} Editar</button>
            <button class="btn btn-danger btn-sm" onclick="deleteCron('${safeId}')" title="Excluir agendamento">${svgIcon('trash')}</button>
          </div>
        </div>`;
      }).join('');
    }

    function openCronModal(id = null) {
      document.getElementById('c-id').value = id || '';
      if (id) {
        const c = cronData.find(x => x.ID === id);
        const raw = c.Horario || '';
        const m = raw.match(/(\d{1,2}):(\d{2})/);
        document.getElementById('c-horario').value = m ? String(m[1]).padStart(2, '0') + ':' + m[2] : '12:00';
        document.getElementById('c-ativo').value = c.Ativo || 'sim';
        document.getElementById('c-plats').value = cronPlatformValue(c.Plataformas);
        document.getElementById('c-tmpl').value = c.Template || '';
        const imgRaw = c.Imagem || '';
        const imgIdMatch = imgRaw.match(/[?&]id=([^&]+)/) || imgRaw.match(/\/d\/([^/]+)/);
        const imgId = imgIdMatch ? imgIdMatch[1] : imgRaw;
        document.getElementById('c-img').value = imgId;
        previewCronImg(imgId);
        document.getElementById('mcron-title').textContent = 'Editar Agendamento';
      } else {
        document.getElementById('c-horario').value = '12:00';
        document.getElementById('c-ativo').value = 'sim';
        document.getElementById('c-plats').value = activePlatform === 'ambos' ? 'ambos' : activePlatform;
        document.getElementById('c-tmpl').value = '';
        document.getElementById('c-img').value = '';
        previewCronImg('');
        document.getElementById('mcron-title').textContent = 'Novo Agendamento';
      }
      document.getElementById('modal-cron').classList.add('open');
    }

    function driveUrl(idOrUrl) {
      if (!idOrUrl) return '';
      const s = idOrUrl.trim();
      if (s.startsWith('http')) return s;
      return `https://drive.google.com/uc?export=view&id=${s}`;
    }

    function previewCronImg(val) {
      const wrap = document.getElementById('c-img-preview');
      const el = document.getElementById('c-img-preview-el');
      const url = driveUrl(val);
      if (url) {
        el.src = url;
        wrap.style.display = 'block';
        el.onerror = () => { wrap.style.display = 'none'; };
      } else {
        wrap.style.display = 'none';
        el.src = '';
      }
    }

    function closeCronModal() {
      document.getElementById('modal-cron').classList.remove('open');
      document.getElementById('c-img-preview').style.display = 'none';
    }

    async function saveCron() {
      const id = document.getElementById('c-id').value, horario = document.getElementById('c-horario').value, ativo = document.getElementById('c-ativo').value, template = document.getElementById('c-tmpl').value, imagem = document.getElementById('c-img').value.trim(), plataformas = document.getElementById('c-plats').value;
      if (!horario) return toast('Selecione um horário', 'err');
      const btn = document.getElementById('btn-save-cron'), sp = document.getElementById('cron-sp');
      btn.disabled = true; sp.classList.add('on');
      try {
        const r = await apiPost({ action: 'salvar_cron', id, horario, ativo, template, imagem, plataformas });
        if (r.status === 'sucesso') { toast('Agendamento salvo na Planilha!'); closeCronModal(); await loadCrons(true); await syncBotCrons(); }
      } catch (e) { toast('Erro ao salvar', 'err'); } finally { btn.disabled = false; sp.classList.remove('on'); }
    }

    async function deleteCron(id) {
      if (!confirm('Excluir este horário?')) return;
      try {
        const r = await apiPost({ action: 'deletar_cron', id });
        if (r.status === 'sucesso') { toast('Excluído da Planilha!'); await loadCrons(true); await syncBotCrons(); }
      } catch (e) { toast('Erro ao excluir', 'err'); }
    }

    async function syncBotCrons() {
      try {
        toast('Avisando o Bot...', 'warn');
        const j = await botFetch('/atualizar-crons');
        if (j.status) { toast(`Bot Atualizado! (${j.crons_ativos} horários)`); addLog(`Bot sync OK: ${j.crons_ativos} CRONs`, 'ok'); }
      } catch (e) { toast(e.message, 'err'); addLog('Erro ao avisar Bot sobre CRONs', 'err'); }
    }

    // -- HISTÓRICO --
    async function loadHistorico(force = false) {
      const grid = document.getElementById('hist-grid');
      if (!force && historicoData.length && Date.now() - _historyLoadedAt < HISTORY_CACHE_TTL) {
        filterHistorico(false);
        return;
      }
      if (_historyPromise && !force) return _historyPromise;

      if (grid) grid.innerHTML = '<div style="grid-column:1/-1"><div class="empty"><div class="eico">⏳</div>Buscando histórico…</div></div>';
      _historyPromise = (async () => {
        try {
          const j = await apiGet({ action: 'listar_historico' });
          if (j.status === 'sucesso') {
            historicoData = j.historico || [];
            _historyLoadedAt = Date.now();
            filterHistorico(false);
            addLog(`Histórico: ${historicoData.length} itens.`, 'ok');
          } else if (grid) {
            grid.innerHTML = '<div style="grid-column:1/-1"><div class="empty"><div class="eico">⚠️</div>Erro ao carregar histórico.</div></div>';
            renderPagination('hist-pagination', 0, historyPage, 'setHistoryPage', 'itens');
          }
        } catch (e) {
          if (grid) grid.innerHTML = '<div style="grid-column:1/-1"><div class="empty"><div class="eico">⚠️</div>Falha de conexão.</div></div>';
          renderPagination('hist-pagination', 0, historyPage, 'setHistoryPage', 'itens');
        } finally {
          _historyPromise = null;
        }
      })();
      return _historyPromise;
    }

    function filterHistorico(resetPage = true) {
      if (resetPage) historyPage = 1;
      const q = normalizeSearchText(document.getElementById('h-s').value);
      const hp = document.getElementById('h-platform')?.value || '';
      renderHistoricoGrid(historicoData.filter(h => {
        const platformOk = !hp || String(h.Plataforma || 'Telegram') === hp;
        const textOk = (h.ID_Produto || '').toLowerCase().includes(q) || (h.Status_Final || '').toLowerCase().includes(q) || (h.Plataforma || '').toLowerCase().includes(q);
        return platformOk && textOk;
      }));
    }

    function renderHistoricoGrid(data) {
      historyView = Array.isArray(data) ? data : [];
      const grid = document.getElementById('hist-grid'), total = historyView.length, suc = historyView.filter(h => (h.Status_Final || '').toLowerCase() === 'sucesso').length;
      document.getElementById('h-tot').textContent = total; document.getElementById('h-suc').textContent = suc; document.getElementById('h-err').textContent = total - suc;
      const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      historyPage = clampPage(historyPage, totalPages);
      const pageItems = historyView.slice((historyPage - 1) * PAGE_SIZE, historyPage * PAGE_SIZE);
      if (!total) {
        grid.innerHTML = '<div style="grid-column:1/-1"><div class="empty"><div class="eico">📭</div>Nada registrado.</div></div>';
        renderPagination('hist-pagination', 0, historyPage, 'setHistoryPage', 'itens');
        return;
      }
      grid.innerHTML = pageItems.map((h, index) => {
        const msgId = h.MessageID || '';
        const isCron = (h.ID_Produto || '').startsWith('CRON_');
        const isCronManual = (h.ID_Produto || '').startsWith('CRON_MANUAL_');
        const hPlat = h.Plataforma || 'Telegram';
        const hPlatKey = hPlat.toLowerCase() === 'whatsapp' ? 'whatsapp' : 'telegram';

        if (isCron) {
          return `<div class="hist-card" style="--i:${Math.min(index, 12)}">
        <div class="hist-card-img-ph" style="background:var(--accent-l);color:var(--accent);font-size:22px">⏰</div>
        <div class="hist-card-body">
          <div class="hist-card-meta"><span class="badge ${h.Status_Final === 'sucesso' ? 'b-done' : 'b-no'}">${esc(h.Status_Final || '—')}</span><span class="hist-card-platform" style="color:var(--accent);font-weight:800">${isCronManual ? 'CRON Manual' : 'Banner CRON'} · ${esc(hPlat)}</span></div>
          <div class="hist-card-name" style="color:var(--text2);font-style:italic">${isCronManual ? 'Disparo manual do agendamento' : 'Disparo agendado automático'}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px"><span class="hist-card-price">—</span><span class="hist-card-date">${esc(h.Data_Envio || '—')}</span></div>
          ${msgId ? `<div style="font-size:10px;color:var(--text3);margin-top:5px;font-family:var(--mono)">msg_id: ${esc(msgId)}</div>` : ''}
        </div>
        <div class="hist-card-footer">
          <button class="btn btn-danger btn-xs btn-full" onclick="apagarCron('${h.ID_Produto}', '${msgId}', '${hPlatKey}')">${svgIcon('trash')} ${hPlatKey === 'whatsapp' ? 'Limpar histórico' : 'Apagar do Canal'}</button>
        </div>
      </div>`;
        }

        const prod = findProductById(h.ID_Produto) || {}, titulo = prod.Título || h.ID_Produto || 'Produto', imagem = prod.Imagem || '', preco = prod.Preço ? fp(prod.Preço) : '—';
        return `<div class="hist-card" style="--i:${Math.min(index, 12)}">
      ${imagem ? `<img class="hist-card-img" src="${esc(imagem)}" onerror="this.src='';this.className='hist-card-img-ph';this.innerHTML='🛍'">` : `<div class="hist-card-img-ph">🛍</div>`}
      <div class="hist-card-body">
        <div class="hist-card-meta"><span class="badge ${h.Status_Final === 'sucesso' ? 'b-done' : 'b-no'}">${esc(h.Status_Final || '—')}</span><span class="hist-card-platform">${esc(hPlat)}</span></div>
        <div class="hist-card-name">${esc(titulo)}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px"><span class="hist-card-price">${preco}</span><span class="hist-card-date">${esc(h.Data_Envio || '—')}</span></div>
        ${msgId ? `<div style="font-size:10px;color:var(--text3);margin-top:5px;font-family:var(--mono)">msg_id: ${esc(msgId)}</div>` : ''}
      </div>
      <div class="hist-card-footer">
        <button class="btn btn-ghost btn-xs" onclick="qSend('${h.ID_Produto}', null, '${hPlatKey}')">${svgIcon('refresh')} Reenviar</button>
        <button class="btn btn-danger btn-xs" onclick="apagarMensagem('${h.ID_Produto}', '${msgId}', '${hPlatKey}')">${svgIcon('trash')} ${hPlatKey === 'whatsapp' ? 'Limpar' : 'Excluir'}</button>
      </div>
    </div>`;
      }).join('');
      renderPagination('hist-pagination', total, historyPage, 'setHistoryPage', 'itens');
    }

    function setHistoryPage(page) {
      historyPage = page;
      renderHistoricoGrid(historyView);
      scrollPanelList('hist-grid');
    }

    // -- AÇÕES DO BOT --
    async function qSend(id, btnEl, plataformas = activePlatform) {
      const p = findProductById(id);
      if (!p) return;
      if (btnEl) btnEl.disabled = true;
      const selected = platformPayload(plataformas);
      toast(`Enviando para ${platformLabel(selected)}…`, 'warn');

      const isUrg = String(p.Urgente || '').toLowerCase() === 'sim';

      try {
        const j = await botFetch('/enviar-oferta', {
          titulo: p.Título || '',
          link: p.Link || '',
          imagem: p.Imagem || '',
          preco: fp(p.Preço) || '',
          categoria: p.Categoria || '',
          urgente: isUrg,
          plataformas: selected
        });
        const results = j.results || {};
        for (const [platform, result] of Object.entries(results)) {
          await apiPost({
            action: 'registrar_postagem',
            id_produto: p.ID,
            message_id: String(result.message_id || ''),
            status: result.ok ? 'sucesso' : 'erro',
            plataforma: platform === 'whatsapp' ? 'WhatsApp' : 'Telegram'
          });
        }
        logPlatformIssues(j, 'Oferta');
        toastPlatformResult(j, isUrg ? '🔥 Oferta URGENTE enviada!' : 'Enviado com sucesso!');
        applyProductSendLocally(p, selected, results);
        if (document.getElementById('p-historico')?.classList.contains('active')) {
          loadHistorico(true).catch(e => addLog(`Histórico não atualizou: ${e.message}`, 'warn'));
        }
        scheduleProductSync();
      } catch (e) { toast(e.message, 'err'); } finally { if (btnEl) btnEl.disabled = false; }
    }

    // ══ Dispara um agendamento específico imediatamente ═══════════════════════
    async function dispararCronAgora(id) {
      const cron = cronData.find(c => String(c.ID) === String(id));
      if (!cron) {
        toast('Agendamento não encontrado no painel. Recarregue a lista.', 'err');
        addLog(`Cron ${id} não encontrado no estado local.`, 'err');
        return;
      }

      const btn = document.getElementById('btn-disp-' + id);
      const oldHtml = btn ? btn.innerHTML : '';
      if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Disparando…'; }

      toast(`Disparando agendamento em ${platformLabel(cronPlatformValue(cron.Plataformas))}…`, 'warn');
      addLog(`Disparo manual iniciado: ${cron.Horario || 'sem horário'} | ${cron.ID}`, 'info');

      try {
        // Envia template/imagem junto com o ID para não depender de uma nova leitura da planilha no backend.
        const j = await botFetch('/disparar-cron', {
          cron_id: cron.ID || id,
          template: cron.Template || '',
          imagem: cron.Imagem || '',
          plataformas: cron.Plataformas || 'telegram'
        });

        logPlatformIssues(j, `Cron ${cron.ID}`);
        toastPlatformResult(j, '⏰ Agendamento disparado com sucesso!');
        addLog(`Cron ${cron.ID} retorno=${j.status || '—'} message_id=${j.message_id || '—'}`, j.ok_all || j.status === 'sucesso' ? 'ok' : 'warn');
        try { await loadHistorico(true); } catch (_) { }
      } catch (e) {
        toast(e.message, 'err');
        addLog(`Erro no disparo manual do cron ${cron.ID}: ${e.message}`, 'err');
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = oldHtml || `${svgIcon('play')} Disparar agora`; }
      }
    }

    async function enviarProximo() {
      const btn = document.getElementById('btn-prox'), sp = document.getElementById('prox-sp');
      btn.disabled = true; sp.classList.add('on');
      try {
        const j = await botFetch('/forcar-postagem', { plataformas: activePlatform });
        if (j.status === 'nenhum_pendente') {
          toast('A fila está vazia.', 'warn');
        } else {
          logPlatformIssues(j, 'Fila');
          toastPlatformResult(j, 'Primeiro da fila enviado!');
        }
        await loadAll(true);
      } catch (e) { toast(e.message, 'err') } finally { btn.disabled = false; sp.classList.remove('on') }
    }

    async function apagarMensagem(id, msgId, plataforma = 'telegram') {
      const isWhatsapp = normalizePlatformKey(plataforma) === 'whatsapp';
      if (!msgId) return toast('Sem message_id salvo.', 'warn');

      if (isWhatsapp) {
        if (!confirm('A API oficial do WhatsApp não permite apagar mensagens já enviadas. Deseja limpar apenas o histórico e retornar para pendente?')) return;
        try {
          await apiPost({ action: 'apagar_historico', id_produto: id, message_id: msgId, plataforma: 'WhatsApp' });
          toast('Histórico do WhatsApp API limpo.');
          await loadAll(true); await loadHistorico(true);
        } catch (err) { toast('Erro ao limpar histórico.', 'err'); }
        return;
      }

      if (!confirm('Apagar do canal Telegram e retornar para a fila de Pendentes?')) return;
      let botOk = false;
      try {
        await botFetch('/apagar-oferta', { id_produto: id, message_id: msgId, plataforma: 'telegram' });
        botOk = true;
      } catch (e) {
        if (e.message.includes("not found")) botOk = true; else toast(e.message, 'err');
      }
      if (botOk) {
        try { await apiPost({ action: 'apagar_historico', id_produto: id, message_id: msgId, plataforma: 'Telegram' }); toast('Apagado e restaurado!'); await loadAll(true); await loadHistorico(true); }
        catch (err) { toast('Erro ao limpar histórico.', 'err'); }
      }
    }

    async function apagarCron(cronId, msgId, plataforma = 'telegram') {
      const isWhatsapp = normalizePlatformKey(plataforma) === 'whatsapp';
      if (!msgId) return toast('Sem message_id salvo — mensagem já pode ter expirado.', 'warn');

      if (isWhatsapp) {
        if (!confirm('Limpar apenas o histórico deste banner do WhatsApp API?')) return;
        try {
          await apiPost({ action: 'apagar_historico', id_produto: cronId, message_id: msgId, plataforma: 'WhatsApp' });
          toast('Histórico do banner limpo.'); await loadHistorico(true);
        } catch (err) { toast('Erro ao limpar histórico.', 'err'); }
        return;
      }

      if (!confirm('Apagar esta mensagem do canal Telegram?')) return;
      let botOk = false;
      try {
        await botFetch('/apagar-oferta', { message_id: msgId, plataforma: 'telegram' });
        botOk = true;
      } catch (e) {
        if (e.message.includes("not found")) botOk = true; else toast(e.message, 'err');
      }
      if (botOk) {
        try {
          await apiPost({ action: 'apagar_historico', id_produto: cronId, message_id: msgId, plataforma: 'Telegram' });
          toast('Banner apagado do canal!'); await loadHistorico(true);
        } catch (err) { toast('Erro ao limpar histórico.', 'err'); }
      }
    }

    // -- EDIÇÃO PRODUTO (MODAL) --
    function openEdit(id) {
      const p = findProductById(id); if (!p) return;
      document.getElementById('e-id').value = id; document.getElementById('e-st').value = p.EnvTelegram || 'pendente'; if(document.getElementById('e-wa')) document.getElementById('e-wa').value = p.EnvWhatsapp || 'pendente'; document.getElementById('e-site').value = p.Status || 'pendente'; document.getElementById('e-pr').value = p.Prioridade || 'média'; document.getElementById('e-cat').value = p.Categoria || ''; document.getElementById('e-com').value = p['Comentário'] || '';
      document.getElementById('modal-edit').classList.add('open');
    }
    function closeModal() { document.getElementById('modal-edit').classList.remove('open') }
    async function saveEdit() {
      const id = document.getElementById('e-id').value, btn = document.getElementById('btn-save-edit'), sp = document.getElementById('save-sp'); btn.disabled = true; sp.classList.add('on');
      try {
        const campos = { 'EnvTelegram': document.getElementById('e-st').value, 'EnvWhatsapp': document.getElementById('e-wa') ? document.getElementById('e-wa').value : 'pendente', 'Status': document.getElementById('e-site').value, 'Prioridade': document.getElementById('e-pr').value, 'Categoria': document.getElementById('e-cat').value, 'Comentário': document.getElementById('e-com').value };
        const j = await apiPost({ action: 'atualizar', id, campos });
        if (j.status === 'sucesso') {
          const p = findProductById(id);
          if (p) Object.assign(p, campos);
          saveManageProductsCache(prods);
          refreshProductViews(false);
          toast('Atualizado!');
          closeModal();
          scheduleProductSync();
        }
      } catch (e) { toast('Erro ao salvar', 'err') } finally { btn.disabled = false; sp.classList.remove('on') }
    }

    // -- CONFIGS & DRAWER MANUAL --
    function loadCfgUI() { const c = getCfg(); document.getElementById('c-sc').value = c.scriptUrl; document.getElementById('c-bot').value = c.botUrl; document.getElementById('c-em').value = c.email; document.getElementById('c-pw').value = c.pass; document.getElementById('c-sec').value = c.secret; document.getElementById('c-grp').value = c.grupo; document.getElementById('c-sit').value = c.site; }
    function saveConf() {
      try {
        sCfg({
          scriptUrl: document.getElementById('c-sc').value.trim(),
          botUrl: document.getElementById('c-bot').value,
          email: document.getElementById('c-em').value.trim(),
          pass: document.getElementById('c-pw').value,
          secret: document.getElementById('c-sec').value,
          grupo: document.getElementById('c-grp').value.trim(),
          site: document.getElementById('c-sit').value.trim()
        });
        loadCfgUI();
        toast('Configurações gravadas!');
      } catch (e) {
        toast(e.message, 'err');
      }
    }

    async function testConn() {
      const c = getCfg(), sp = document.getElementById('test-sp'), res = document.getElementById('test-result');
      sp.classList.add('on'); res.style.display = 'none'; const results = [];
      try {
        const r = await fetchWithTimeout(`${c.scriptUrl}?key=${encodeURIComponent(authTok || c.pass)}&action=listar`);
        const j = await r.json();
        results.push(`<div style="color:var(--green)">✅ Apps Script: OK (${j.produtos?.length || 0} itens)</div>`);
      } catch (e) { results.push(`<div style="color:var(--red)">❌ Apps Script: ${describeFetchError(e)}</div>`) }
      try {
        const base = getBotBaseUrl();
        const r = await fetchWithTimeout(`${base}/ping`, { method: 'GET', redirect: 'follow', timeout: 8000 });
        const j = await r.json();
        results.push(`<div style="color:var(--green)">✅ Bot Discloud: Online — ${j.hora || ''}</div>`);
      } catch (e) { results.push(`<div style="color:var(--red)">❌ Bot Discloud: ${describeFetchError(e)}</div>`) }
      res.innerHTML = `<div style="padding:18px;background:var(--surface);border:1.5px solid var(--border);border-radius:var(--r-lg);display:flex;flex-direction:column;gap:10px;font-size:13px;font-weight:700">${results.join('')}</div>`;
      sp.classList.remove('on'); res.style.display = 'block';
    }

    function openDrawer() {
      document.getElementById('drawer').classList.add('open');
      const dp = document.getElementById('d-plats');
      if (dp) dp.value = activePlatform === 'ambos' ? 'ambos' : activePlatform;
      const sel = document.getElementById('d-sel');
      sel.innerHTML = '<option value="">— Em Branco —</option>';
      prods.slice(0, 25).forEach(p => {
        const cat = p.Categoria ? ` · ${p.Categoria}` : '';
        sel.innerHTML += `<option value="${p.ID}">${esc((p.Título || '').substring(0, 32))}${esc(cat)}</option>`;
      });
    }
    function closeDrawer() { document.getElementById('drawer').classList.remove('open') }
    function onDrSel() {
      const p = findProductById(document.getElementById('d-sel').value);
      if (p) {
        document.getElementById('d-lnk').value = p.Link || '';
        document.getElementById('d-tit').value = p.Título || '';
        document.getElementById('d-cat').value = p.Categoria || '';
        document.getElementById('d-pre').value = fp(p.Preço);
        document.getElementById('d-img').value = p.Imagem || '';
      }
    }
    async function sendManual() {
      const titulo = document.getElementById('d-tit').value,
        link = document.getElementById('d-lnk').value,
        categoria = document.getElementById('d-cat')?.value || '',
        imagem = document.getElementById('d-img').value,
        preco = document.getElementById('d-pre').value,
        plataformas = document.getElementById('d-plats')?.value || activePlatform;
      if (!titulo || !link) return toast('Título e Link obrigatórios', 'err');
      const btn = document.getElementById('btn-snd'), sp = document.getElementById('snd-sp'); btn.disabled = true; sp.classList.add('on');
      try {
        const j = await botFetch('/enviar-oferta', { titulo, link, imagem, preco, categoria, plataformas });
        logPlatformIssues(j, 'Avulso');
        toastPlatformResult(j, 'Avulso enviado!');
        if (getPlatformResultsSummary(j).okAny) closeDrawer();
        loadAll();
      } catch (e) { toast(e.message, 'err') } finally { btn.disabled = false; sp.classList.remove('on') }
    }

    async function checkBot() {
      const c = getCfg();
      if (!c.botUrl) return;
      try {
        const base = getBotBaseUrl();
        const r = await fetchWithTimeout(`${base}/ping`, { method: 'GET', redirect: 'follow', timeout: 8000 });
        if (r.ok || r.type === 'opaque') {
          document.getElementById('bot-pulse').className = 'pulse on';
          document.getElementById('bot-lbl').textContent = 'Bot Ativo';
        } else throw new Error(`HTTP ${r.status}`);
      } catch (e) {
        document.getElementById('bot-pulse').className = 'pulse err';
        document.getElementById('bot-lbl').textContent = 'Bot Offline';
        addLog(`Ping falhou: ${describeFetchError(e)}`, 'err');
      }
    }

    async function refreshStatus() {
      const sp = document.getElementById('st-sp'); sp.classList.add('on');
      try {
        const base = getBotBaseUrl();
        const r = await fetchWithTimeout(`${base}/ping`, { method: 'GET', redirect: 'follow', timeout: 10000 });
        const j = await r.json();
        document.getElementById('st-status').className = 'badge b-done'; document.getElementById('st-status').textContent = 'Online'; document.getElementById('st-hora').textContent = j.hora || '--:--';
        document.getElementById('sess-env').textContent = j.stats?.enviados || 0; document.getElementById('sess-err').textContent = j.stats?.erros || 0;
        if (j.stats?.inicio) document.getElementById('sess-ini').textContent = new Date(j.stats.inicio).toLocaleTimeString('pt-BR');
        addLog('Ping OK — Bot online.', 'ok');
      } catch (e) {
        document.getElementById('st-status').className = 'badge b-no';
        document.getElementById('st-status').textContent = 'Offline';
        addLog(`Ping falhou: ${describeFetchError(e)}`, 'err');
      } finally { sp.classList.remove('on') }
    }

    function initManageBot() {
      initTheme();
      const saved = localStorage.getItem('acd_auth_v5');
      if (saved) { authTok = saved; boot(); return; }
      const cfg = getCfg();
      if (!cfg.scriptUrl && !cfg.email) {
        document.getElementById('l-setup').style.display = 'block';
        document.getElementById('l-title').textContent = 'Configuração inicial';
        document.getElementById('l-sub').textContent = 'Preencha os dados do projeto para começar.';
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initManageBot, { once: true });
    } else {
      initManageBot();
    }

    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!target.closest?.('#product-context') && !target.closest?.('.queue-card')) hideProductContext();
      if (!target.closest?.('#product-preview') && !target.closest?.('.queue-card') && !target.closest?.('#product-context')) closeProductPreview();
      if (target.classList?.contains('overlay') && target.classList.contains('open')) {
        target.classList.remove('open');
        if (target.id === 'modal-cron') document.getElementById('c-img-preview').style.display = 'none';
      }
      if (document.getElementById('drawer')?.classList.contains('open') && !target.closest?.('#drawer') && !target.closest?.('[data-drawer-trigger]')) closeDrawer();
    });

    document.addEventListener('contextmenu', (event) => {
      if (!event.target.closest?.('.queue-card') && !event.target.closest?.('#product-context')) hideProductContext();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      hideProductContext();
      closeProductPreview();
      closeDrawer();
      document.querySelectorAll('.overlay.open').forEach(overlay => overlay.classList.remove('open'));
      if (document.getElementById('c-img-preview')) document.getElementById('c-img-preview').style.display = 'none';
    });
