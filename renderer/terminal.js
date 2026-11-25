'use strict';

(function () {
  const Terminal = window.Terminal;
  // Аддоны @xterm/addon-* собраны как UMD, который кладёт на window не сам класс,
  // а namespace { FitAddon: class } — достаём класс из него, с fallback на прямое
  // значение (если в другой версии класс лежит сразу на window).
  const FitAddon = (window.FitAddon && window.FitAddon.FitAddon) || window.FitAddon;
  const SearchAddon = (window.SearchAddon && window.SearchAddon.SearchAddon) || window.SearchAddon;
  // Модуль автодополнения (#14): подсказки из истории сессии и скроллбэка.
  const Auto = window.Autocomplete;

  if (!Terminal || !FitAddon || !SearchAddon) {
    console.error('TERMINAL: xterm.js vendor files not loaded');
    return;
  }

  // Цветовые схемы терминала. Согласованы с токенами приложения; применяются
  // к canvas-рендеру xterm.js, поэтому заданы как данные, а не CSS-токены.
  const THEMES = {
    light: {
      background: '#ffffff', foreground: '#1d1d1f', cursor: '#0a84ff', cursorAccent: '#ffffff',
      selectionBackground: 'rgba(10, 132, 255, 0.3)',
      black: '#1d1d1f', red: '#ff3b30', green: '#248a3d', yellow: '#b25000',
      blue: '#0a84ff', magenta: '#bf5af2', cyan: '#0071a4', white: '#aeaeb2',
      brightBlack: '#6e6e73', brightRed: '#ff6961', brightGreen: '#30d158', brightYellow: '#ffd60a',
      brightBlue: '#64d2ff', brightMagenta: '#da8fff', brightCyan: '#66d4cf', brightWhite: '#ffffff'
    },
    dark: {
      background: '#161618', foreground: '#f5f5f7', cursor: '#0a84ff', cursorAccent: '#161618',
      selectionBackground: 'rgba(10, 132, 255, 0.35)',
      black: '#161618', red: '#ff453a', green: '#30d158', yellow: '#ffd60a',
      blue: '#0a84ff', magenta: '#bf5af2', cyan: '#5e5ce6', white: '#aeaeb2',
      brightBlack: '#636366', brightRed: '#ff6961', brightGreen: '#30d158', brightYellow: '#ffd60a',
      brightBlue: '#64d2ff', brightMagenta: '#da8fff', brightCyan: '#66d4cf', brightWhite: '#ffffff'
    }
  };

  const SEARCH_DECORATIONS = {
    matchBackground: '#264f78',
    matchBorder: '#0a84ff',
    matchOverviewRuler: '#0a84ff',
    activeMatchBackground: '#0a84ff',
    activeMatchBorder: '#64d2ff',
    activeMatchColorOverviewRuler: '#64d2ff'
  };

  const STATUS_LABELS = { connecting: 'подключение', active: 'подключено', exited: 'завершено', error: 'ошибка' };

  // Модель (flat): вкладка = { key, payload, title, direction, activeKey, panes, host },
  // панель = { key, term, fitAddon, searchAddon, el, bar, dot, label, body,
  //            status, sessionId, exitCode, observer }.
  // key вкладки и key/sessionId панели генерируются в рендере и уходят в main,
  // чтобы события term:data / term:exit сразу находили свою панель.
  const tabs = new Map(); // key -> tab
  let activeKey = null;
  let seq = 0;
  let searchVisible = false;
  let snippetsVisible = false;
  let broadcastOn = false;

  /* ---------- theme ---------- */
  function termThemePreference() {
    const s = (state.data && state.data.settings) || {};
    return s.terminalTheme || s.theme || 'system';
  }
  function resolvedTheme() {
    const t = termThemePreference();
    if (t === 'light' || t === 'dark') return t;
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  function currentPalette() { return THEMES[resolvedTheme()]; }
  function applyThemeTo(tab) { tab.panes.forEach((p) => { if (p.term) p.term.options.theme = currentPalette(); }); }
  function applyThemeAll() { tabs.forEach(applyThemeTo); renderThemeSeg(); }
  function renderThemeSeg() {
    const pref = termThemePreference();
    $$('#term-theme-seg button').forEach((b) => b.classList.toggle('active', b.dataset.val === pref));
  }

  /* ---------- tab / pane helpers ---------- */
  function activeTab() { return activeKey ? tabs.get(activeKey) : null; }
  function activePaneOf(tab) {
    if (!tab || !tab.panes.length) return null;
    return tab.panes.find((p) => p.key === tab.activeKey) || tab.panes[tab.panes.length - 1];
  }
  function activePane() { return activePaneOf(activeTab()); }
  function findPane(tab, key) { return tab.panes.find((p) => p.key === key) || null; }
  function findBySessionId(id) {
    for (const t of tabs.values()) {
      const p = findPane(t, id);
      if (p) return p;
    }
    return null;
  }

  /* ---------- render ---------- */
  function tabEl(t) {
    const ap = activePaneOf(t);
    const status = (ap && ap.status) || 'connecting';
    const exitCode = ap ? ap.exitCode : null;
    const label = STATUS_LABELS[status] || STATUS_LABELS.connecting;
    let stateWord = '';
    if (status !== 'active') {
      stateWord = (status === 'exited' && exitCode != null)
        ? `<span class="term-tab-state">${esc(label)} · код ${esc(exitCode)}</span>`
        : `<span class="term-tab-state">${esc(label)}</span>`;
    }
    return `
      <div class="term-tab ${t.key === activeKey ? 'active' : ''}" data-action="term-select" data-key="${esc(t.key)}" role="tab" aria-selected="${t.key === activeKey ? 'true' : 'false'}" aria-label="${esc(t.title)} — ${esc(label)}" tabindex="0">
        <span class="term-status ${esc(status)}" aria-hidden="true"></span>
        <span class="term-tab-title">${esc(t.title)}</span>
        ${stateWord}
        <button class="term-tab-close" data-action="term-close" data-key="${esc(t.key)}" title="Закрыть вкладку" aria-label="Закрыть вкладку">×</button>
      </div>`;
  }

  function renderTabs() {
    const bar = $('#term-tabs');
    if (bar) bar.innerHTML = Array.from(tabs.values()).map(tabEl).join('');
  }

  function renderPaneStatus(pane) {
    const status = pane.status || 'connecting';
    pane.dot.className = 'term-status ' + status;
    const label = STATUS_LABELS[status] || STATUS_LABELS.connecting;
    pane.label.textContent = (status === 'exited' && pane.exitCode != null)
      ? label + ' · код ' + pane.exitCode
      : label;
  }

  function renderStage() {
    const stage = $('#term-stage');
    if (!stage) return;
    tabs.forEach((t) => {
      t.host.classList.toggle('hidden', t.key !== activeKey);
      t.host.classList.toggle('row', t.direction === 'row');
      t.host.classList.toggle('column', t.direction === 'column');
      t.panes.forEach((p) => p.el.classList.toggle('active', p.key === t.activeKey));
    });
    let empty = stage.querySelector('.term-empty');
    if (tabs.size === 0) {
      if (!empty) {
        empty = document.createElement('div');
        empty.className = 'term-empty';
        empty.innerHTML = '<svg viewBox="0 0 24 24" class="ico"><path d="m4 17 6-5-6-5M12 19h8"/></svg><h3>Нет открытых сессий</h3><p>Подключитесь к серверу или псевдониму</p>';
        stage.appendChild(empty);
      }
      empty.classList.remove('hidden');
    } else if (empty) {
      empty.classList.add('hidden');
    }
  }

  function render() { renderTabs(); renderStage(); }

  function fitPane(pane) {
    if (!pane || !pane.body || !pane.fitAddon) return;
    const w = pane.body.offsetWidth;
    const h = pane.body.offsetHeight;
    if (!w || !h) return;
    try { pane.fitAddon.fit(); } catch (e) { /* ignore */ }
    if (pane.sessionId && pane.term.cols && pane.term.rows) {
      bridge.resizeTerminal(pane.sessionId, pane.term.cols, pane.term.rows);
    }
  }

  function fitAll(tab) { if (tab) tab.panes.forEach(fitPane); }

  function activate(key) {
    activeKey = key;
    render();
    const t = tabs.get(key);
    if (t) setTimeout(() => fitAll(t), 0);
    syncBroadcast();
  }

  function activatePane(tab, key) {
    tab.activeKey = key;
    if (Auto) tab.panes.forEach((p) => Auto.dismiss(p));
    renderStage();
    const pane = findPane(tab, key);
    if (pane) setTimeout(() => fitPane(pane), 0);
  }

  /* ---------- open / split / close ---------- */
  function serverPayload(server) {
    // В IPC уходит только то, что нужно для сборки argv ssh; пароль сервера
    // и парольная фраза ключа сюда не попадают (вводятся пользователем в PTY).
    return {
      type: 'server',
      server: {
        host: server.host,
        port: server.port,
        user: server.user,
        authMethod: server.authMethod,
        keyPath: server.keyPath,
        extraArgs: server.extraArgs
      }
    };
  }

  function openServer(server) {
    if (!server || !server.host) { toast('Не заполнен адрес сервера', 'error'); return; }
    const title = server.name || server.host;
    state.view = 'terms';
    window.render();
    openTab(serverPayload(server), title);
  }

  function openAlias(alias) {
    const name = String(alias || '').trim();
    if (!name) { toast('Не указан псевдоним', 'error'); return; }
    state.view = 'terms';
    window.render();
    openTab({ type: 'alias', alias: name }, name);
  }

  function openTab(payload, title) {
    const stage = $('#term-stage');
    if (!stage) return;
    const key = 't' + (seq++) + '_' + Date.now().toString(36);

    const host = document.createElement('div');
    host.className = 'term-panes';
    stage.appendChild(host);

    const tab = { key, payload, title, direction: null, activeKey: null, panes: [], host };
    tabs.set(key, tab);

    createPane(tab, payload);
    activate(key);
  }

  function createPane(tab, payload) {
    const key = 'p' + (seq++) + '_' + Date.now().toString(36);

    const el = document.createElement('div');
    el.className = 'term-pane';
    el.dataset.key = key;
    el.dataset.action = 'term-pane-focus';
    el.setAttribute('role', 'tabpanel');

    const bar = document.createElement('div');
    bar.className = 'term-pane-bar';
    const dot = document.createElement('span');
    dot.className = 'term-status connecting';
    dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'term-pane-state';
    label.textContent = STATUS_LABELS.connecting;
    const close = document.createElement('button');
    close.className = 'term-pane-close';
    close.dataset.action = 'term-pane-close';
    close.dataset.key = key;
    close.setAttribute('title', 'Закрыть панель');
    close.setAttribute('aria-label', 'Закрыть панель');
    close.textContent = '×';
    bar.appendChild(dot);
    bar.appendChild(label);
    bar.appendChild(close);

    const body = document.createElement('div');
    body.className = 'term-pane-body';
    el.appendChild(bar);
    el.appendChild(body);
    tab.host.appendChild(el);

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
      fontSize: 13,
      scrollback: 5000,
      theme: currentPalette()
    });
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.open(body);

    const pane = { key, term, fitAddon, searchAddon, el, bar, dot, label, body, status: 'connecting', sessionId: key, exitCode: null, observer: null };
    tab.panes.push(pane);
    if (Auto) Auto.mount(pane);

    // Ввод с клавиатуры и вставка (Cmd+V) уходят в PTY этой панели; при
    // включённом broadcast ввод из активной панели дублируется в остальные.
    term.onData((data) => {
      if (!pane.sessionId) return;
      bridge.writeTerminal(pane.sessionId, data);
      if (Auto) Auto.onInput(pane, data);
      if (broadcastOn && activePaneOf(tab) === pane) broadcastData(tab, pane, data);
    });

    const observer = new ResizeObserver(() => fitPane(pane));
    observer.observe(body);
    pane.observer = observer;

    activatePane(tab, key);
    setTimeout(() => term.focus(), 40);

    bridge.createTerminal(Object.assign({}, payload, { id: key, cols: 80, rows: 24 }))
      .then(() => {
        if (findPane(tab, key)) fitPane(pane);
      })
      .catch((err) => {
        if (!findPane(tab, key)) return;
        pane.status = 'error';
        renderPaneStatus(pane);
        renderTabs();
        term.write('\r\n[Ошибка подключения]\r\n');
        toast(err && err.message ? err.message : 'Не удалось запустить сессию', 'error');
      });
  }

  function splitPane(direction) {
    const tab = activeTab();
    if (!tab) return;
    // Каждая кнопка задаёт направление раскладки всех панелей вкладки:
    // «вертикально» = row (бок о бок), «горизонтально» = column (стопкой).
    tab.direction = direction;
    createPane(tab, tab.payload);
    syncBroadcast();
  }

  function closePane(tab, key) {
    const idx = tab.panes.findIndex((p) => p.key === key);
    if (idx < 0) return;
    const pane = tab.panes[idx];
    tab.panes.splice(idx, 1);
    if (pane.sessionId) bridge.killTerminal(pane.sessionId);
    if (Auto) Auto.dispose(pane);
    if (pane.observer) pane.observer.disconnect();
    try { pane.term.dispose(); } catch (e) { /* ignore */ }
    if (pane.el && pane.el.parentNode) pane.el.parentNode.removeChild(pane.el);

    if (tab.panes.length === 0) { closeTab(tab.key); return; }
    if (tab.activeKey === key) {
      const next = tab.panes[idx] || tab.panes[idx - 1];
      tab.activeKey = next ? next.key : null;
    }
    renderStage();
    const ap = activePaneOf(tab);
    if (ap) setTimeout(() => { fitPane(ap); ap.term.focus(); }, 0);
    syncBroadcast();
  }

  function closeTab(key) {
    const t = tabs.get(key);
    if (!t) return;
    tabs.delete(key);
    for (const pane of t.panes) {
      if (pane.sessionId) bridge.killTerminal(pane.sessionId);
      if (Auto) Auto.dispose(pane);
      if (pane.observer) pane.observer.disconnect();
      try { pane.term.dispose(); } catch (e) { /* ignore */ }
    }
    if (t.host && t.host.parentNode) t.host.parentNode.removeChild(t.host);
    if (activeKey === key) activeKey = Array.from(tabs.keys()).pop() || null;
    render();
    if (activeKey) {
      const next = tabs.get(activeKey);
      const ap = activePaneOf(next);
      if (ap) setTimeout(() => fitPane(ap), 0);
    }
    syncBroadcast();
  }

  function switchPane(tab, delta) {
    if (!tab || tab.panes.length < 2) return;
    let idx = tab.panes.findIndex((p) => p.key === tab.activeKey);
    if (idx < 0) idx = 0;
    const next = tab.panes[(idx + delta + tab.panes.length) % tab.panes.length];
    activatePane(tab, next.key);
    setTimeout(() => next.term.focus(), 0);
  }

  /* ---------- pty events ---------- */
  function onData(id, data) {
    const p = findBySessionId(id);
    if (!p) return;
    p.term.write(data);
    if (p.status === 'connecting') { p.status = 'active'; renderPaneStatus(p); renderTabs(); }
  }
  function onExit(id, code) {
    const p = findBySessionId(id);
    if (!p) return;
    p.status = 'exited';
    p.exitCode = code;
    renderPaneStatus(p);
    renderTabs();
  }

  /* ---------- search ---------- */
  function searchOptions() {
    const regexEl = $('#term-regex');
    return {
      regex: !!(regexEl && regexEl.checked),
      caseSensitive: false,
      incremental: false,
      decorations: SEARCH_DECORATIONS
    };
  }

  function doSearch(incremental) {
    const p = activePane();
    const input = $('#term-search-input');
    if (!p || !input) return;
    const q = input.value;
    if (!q) { p.searchAddon.clearDecorations(); return; }
    const opts = Object.assign({}, searchOptions(), { incremental: !!incremental });
    p.searchAddon.findNext(q, opts);
  }

  function toggleSearch() {
    searchVisible = !searchVisible;
    const bar = $('#term-searchbar');
    if (bar) bar.classList.toggle('hidden', !searchVisible);
    const input = $('#term-search-input');
    if (searchVisible && input) { input.focus(); input.select(); }
    if (!searchVisible) clearSearch();
  }

  function clearSearch() {
    const p = activePane();
    if (p) p.searchAddon.clearDecorations();
    const input = $('#term-search-input');
    if (input) input.value = '';
  }

  /* ---------- snippets ---------- */
  function renderTermSnippets() {
    const box = $('#term-snippets-list');
    if (!box) return;
    const snippets = (state.data && state.data.snippets) || [];
    if (!snippets.length) {
      box.innerHTML = '<div class="term-snippets-empty">Нет сниппетов — добавьте в Настройках</div>';
      return;
    }
    box.innerHTML = snippets.map((s) => `
      <button class="term-snippet" data-action="term-snippet-insert" data-id="${esc(s.id)}" title="${esc(s.command)}" aria-label="Вставить команду: ${esc(s.name)}">
        <span class="term-snippet-name">${esc(s.name)}</span>
        <span class="term-snippet-cmd mono">${esc(s.command)}</span>
      </button>`).join('');
  }

  function toggleSnippets() {
    snippetsVisible = !snippetsVisible;
    const panel = $('#term-snippets');
    if (panel) panel.classList.toggle('hidden', !snippetsVisible);
    const btn = $('#term-snippets-toggle');
    if (btn) btn.setAttribute('aria-pressed', String(snippetsVisible));
    if (snippetsVisible) renderTermSnippets();
  }

  function insertSnippet(id) {
    const snippets = (state.data && state.data.snippets) || [];
    const sn = snippets.find((x) => x.id === id);
    if (!sn) return;
    const pane = activePane();
    if (!pane || !pane.sessionId) { toast('Нет активной сессии', 'error'); return; }
    bridge.writeTerminal(pane.sessionId, sn.command);
  }

  /* ---------- broadcast ---------- */
  // Вещание: ввод из активной панели дублируется во все остальные панели той же
  // вкладки (один ввод → N серверов). Флаг модульный — один на весь терминал;
  // число целей N всегда пересчитывается от активной вкладки.
  function broadcastTargetsCount() {
    const t = activeTab();
    return t ? Math.max(0, t.panes.length - 1) : 0;
  }

  function broadcastData(tab, sourcePane, data) {
    for (const p of tab.panes) {
      if (p === sourcePane || !p.sessionId) continue;
      bridge.writeTerminal(p.sessionId, data);
      // Трекер ввода целевых панелей держим в синхронизации с PTY (подсказки
      // там не показываются — ввод идёт из активной панели).
      if (Auto) Auto.onBroadcast(p, data);
    }
  }

  function renderBroadcastBtn() {
    const btn = $('#term-broadcast-toggle');
    if (!btn) return;
    const n = broadcastTargetsCount();
    btn.classList.toggle('ghost', !broadcastOn);
    btn.classList.toggle('primary', broadcastOn);
    btn.setAttribute('aria-pressed', String(broadcastOn));
    btn.setAttribute('aria-label', broadcastOn
      ? 'Вещание включено: ввод идёт на ' + n + ' панелей'
      : 'Вещание выключено');
    btn.textContent = broadcastOn ? 'Вещание · ' + n : 'Вещание';
  }

  function syncBroadcast() {
    if (broadcastOn && broadcastTargetsCount() < 1) broadcastOn = false;
    renderBroadcastBtn();
  }

  function toggleBroadcast() {
    if (broadcastOn) {
      broadcastOn = false;
      toast('Вещание выключено');
      renderBroadcastBtn();
      return;
    }
    const n = broadcastTargetsCount();
    if (n < 1) {
      toast('Нет других панелей', 'error');
      return;
    }
    broadcastOn = true;
    toast('Вещание включено: ввод идёт на ' + n + ' панелей');
    renderBroadcastBtn();
  }

  /* ---------- edit-команды меню ---------- */
  // Выделение xterm.js не видно нативным ролям Edit (#45): команда приходит из
  // меню, обрабатываем её здесь. true — команду забрал терминал, иначе рендер
  // делает DOM-фолбэк для обычных полей.
  function focusedTerminalPane() {
    const tab = activeTab();
    const el = document.activeElement;
    if (!tab || !el) return null;
    for (const p of tab.panes) {
      if (p.term && p.term.element && p.term.element.contains(el)) return p;
    }
    return null;
  }

  function editCommand(command, text) {
    const pane = focusedTerminalPane();
    if (!pane) return false;
    if (command === 'copy') {
      if (pane.term.hasSelection()) copyText(pane.term.getSelection());
      return true;
    }
    if (command === 'cut') return true; // в терминале вырезать нечего
    if (command === 'paste') {
      if (typeof text === 'string' && text) pane.term.paste(text);
      return true;
    }
    if (command === 'select-all') { pane.term.selectAll(); return true; }
    return false;
  }

  /* ---------- init ---------- */
  function init() {
    bridge.onTermData(onData);
    bridge.onTermExit(onExit);

    renderThemeSeg();
    render();
    syncBroadcast();

    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const action = el.dataset.action;

      if (action === 'term-select') { activate(el.dataset.key); return; }
      if (action === 'term-close') { closeTab(el.dataset.key); return; }
      if (action === 'term-split-v') { splitPane('row'); return; }
      if (action === 'term-split-h') { splitPane('column'); return; }
      if (action === 'term-pane-focus') {
        const t = activeTab();
        if (!t) return;
        activatePane(t, el.dataset.key);
        const p = findPane(t, el.dataset.key);
        if (p) setTimeout(() => p.term.focus(), 0);
        return;
      }
      if (action === 'term-pane-close') {
        const t = activeTab();
        if (t) closePane(t, el.dataset.key);
        return;
      }
      if (action === 'term-search-toggle') { toggleSearch(); return; }
      if (action === 'term-ac-toggle') {
        const p = activePane();
        if (p && Auto) Auto.toggle(p);
        return;
      }
      if (action === 'term-snippets-toggle') { toggleSnippets(); return; }
      if (action === 'term-broadcast-toggle') { toggleBroadcast(); return; }
      if (action === 'term-snippet-insert') { insertSnippet(el.dataset.id); return; }
      if (action === 'term-search-next') { doSearch(false); return; }
      if (action === 'term-search-prev') {
        const p = activePane();
        const input = $('#term-search-input');
        if (p && input && input.value) p.searchAddon.findPrevious(input.value, searchOptions());
        return;
      }
      if (action === 'nav' && el.dataset.view === 'terms') {
        renderThemeSeg();
        const t = activeTab();
        if (t) setTimeout(() => fitAll(t), 0);
        return;
      }
    });

    // Тема терминала — отдельный переключатель (не трогает тему приложения)
    document.addEventListener('click', (e) => {
      const b = e.target.closest('#term-theme-seg button');
      if (!b) return;
      const val = b.dataset.val;
      if (!state.data) state.data = { settings: {} };
      if (!state.data.settings) state.data.settings = {};
      state.data.settings.terminalTheme = val;
      applyThemeAll();
      persist();
    });

    // Клавиатура на вкладках (Enter/Space)
    document.addEventListener('keydown', (e) => {
      const tab = e.target.closest('.term-tab[data-action="term-select"]');
      if (tab && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        activate(tab.dataset.key);
        return;
      }
    });

    // Хоткеи панелей (только на экране терминала): ⌘D/⌘⇧D — разделить,
    // ⌘[/⌘] и ⌘⌥←/→ — переключение, ⌘W — закрыть активную панель.
    document.addEventListener('keydown', (e) => {
      if (!e.metaKey) return;
      if (state.view !== 'terms') return;
      const t = activeTab();

      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        switchPane(t, e.key === 'ArrowRight' ? 1 : -1);
        return;
      }
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        splitPane(e.shiftKey ? 'column' : 'row');
        return;
      }
      if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        switchPane(t, e.key === ']' ? 1 : -1);
        return;
      }
      if (e.key === 'w' || e.key === 'W') {
        if (!t) return;
        e.preventDefault();
        closePane(t, t.activeKey);
        return;
      }
    });

    document.addEventListener('input', (e) => {
      if (e.target.id === 'term-search-input') doSearch(true);
    });
    document.addEventListener('change', (e) => {
      if (e.target.id === 'term-regex') doSearch(true);
    });

    // Enter — далее, Esc — закрыть поиск
    document.addEventListener('keydown', (e) => {
      if (!searchVisible) return;
      if (e.key === 'Escape') { toggleSearch(); return; }
      if (e.key === 'Enter' && e.target && e.target.id === 'term-search-input') {
        doSearch(false);
        return;
      }
    });

    // Esc — закрыть панель сниппетов
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && snippetsVisible) toggleSnippets();
    });

    // Реакция на смену системной темы, когда терминал в режиме «Система»
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (termThemePreference() === 'system') applyThemeAll();
      });
    }
  }

  window.Term = { openServer, openAlias, closeTab, renderSnippets: renderTermSnippets, editCommand };
  init();
})();
