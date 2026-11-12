'use strict';

const bridge = window.api;
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

window.addEventListener('error', (e) => console.error('RENDERER ERROR:', e.message));
window.addEventListener('unhandledrejection', (e) => console.error('RENDERER REJECTION:', e.reason));

const PALETTE = ['#0a84ff', '#30d158', '#ff9f0a', '#ff375f', '#bf5af2', '#ffd60a', '#5e5ce6', '#64d2ff', '#66d4cf', '#ff6961'];

const ICONS = {
  copy: '<svg viewBox="0 0 24 24" class="ico"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" class="ico"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" class="ico"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
  folder: '<svg viewBox="0 0 24 24" class="ico"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>',
  terminal: '<svg viewBox="0 0 24 24" class="ico"><path d="m4 17 6-5-6-5M12 19h8"/></svg>',
  key: '<svg viewBox="0 0 24 24" class="ico"><path d="M15.5 7.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/><path d="m21 2-4 4"/><path d="M9.5 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/><path d="M14.5 11.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/><path d="m13 7 4 4"/><path d="m7 13 4 4"/><path d="m2 22 5-5"/><path d="M2 17a5 5 0 0 1 5 5"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" class="ico chevron"><path d="m6 9 6 6 6-6"/></svg>',
  lock: '<svg viewBox="0 0 24 24" class="ico"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  server: '<svg viewBox="0 0 24 24" class="ico"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>',
  tag: '<svg viewBox="0 0 24 24" class="ico"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r="1"/></svg>'
};

const state = {
  data: null,
  keys: [],
  aliases: [],
  view: 'keys',
  searchKeys: '',
  searchServers: '',
  searchAliases: '',
  groupFilter: 'all',
  encrypted: false
};

/* ---------- utils ---------- */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function shorten(p, n = 34) {
  if (!p) return '';
  return p.length > n ? '…' + p.slice(-(n - 1)) : p;
}
function fmtDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}
function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'error' ? ' error' : '');
  el.textContent = msg;
  $('#toast-root').appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
function normalizeData(d) {
  if (!d || typeof d !== 'object') d = {};
  return {
    version: 1,
    servers: Array.isArray(d.servers) ? d.servers : [],
    keyMeta: d.keyMeta && typeof d.keyMeta === 'object' ? d.keyMeta : {},
    settings: Object.assign({ theme: 'system' }, d.settings)
  };
}
async function persist() {
  await bridge.save(state.data);
}

/* ---------- theme ---------- */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t || 'system');
  localStorage.setItem('theme', t || 'system');
}

/* ---------- bootstrap ---------- */
async function init() {
  const st = await bridge.getState();
  state.encrypted = st.encrypted;
  $('#data-dir').textContent = shorten(st.dataDir);
  $('#data-dir').title = st.dataDir;
  $('#settings-datadir').textContent = st.dataDir;

  if (st.locked) {
    $('#unlock').classList.remove('hidden');
    $('#app').classList.add('hidden');
    $('#unlock-password').focus();
  } else {
    await enterApp();
  }
}

async function enterApp() {
  $('#unlock').classList.add('hidden');
  $('#app').classList.remove('hidden');
  const d = await bridge.getData();
  state.data = normalizeData(d);
  applyTheme(state.data.settings.theme || 'system');
  await refreshKeys();
  await refreshAliases();
  render();
}

async function refreshKeys() {
  try {
    state.keys = await bridge.scanKeys();
  } catch {
    state.keys = [];
  }
}

async function refreshAliases() {
  try {
    state.aliases = await bridge.listHosts();
  } catch {
    state.aliases = [];
  }
}

/* ---------- render ---------- */
function render() {
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  $('#keys-count').textContent = state.keys.length;
  $('#aliases-count').textContent = state.aliases.length;
  $('#servers-count').textContent = (state.data.servers || []).length;

  $$('.view').forEach((v) => v.classList.add('hidden'));
  $('#view-' + state.view).classList.remove('hidden');

  if (state.view === 'keys') renderKeys();
  else if (state.view === 'aliases') renderAliases();
  else if (state.view === 'servers') renderServers();
  else if (state.view === 'settings') renderSettings();
}

function renderKeys() {
  const q = state.searchKeys.toLowerCase();
  const list = state.keys.filter((k) => {
    const hay = (k.name + ' ' + k.comment + ' ' + k.type + ' ' + k.fingerprint).toLowerCase();
    return !q || hay.includes(q);
  });

  if (!list.length) {
    $('#keys-list').innerHTML = emptyState(
      q ? 'Ничего не найдено' : 'Ключей пока нет',
      q ? 'Попробуйте другой запрос.' : 'Создайте новый ключ или положите существующий в ~/.ssh.'
    );
    return;
  }

  $('#keys-list').innerHTML = `<div class="key-list">${list.map(keyCard).join('')}</div>`;
}

function keyCard(k) {
  const meta = (state.data.keyMeta || {})[k.name] || {};
  const displayName = meta.alias || k.name;
  return `
    <div class="card key-card" data-action="key-toggle" data-name="${esc(k.name)}">
      <div class="key-head">
        <div class="key-glyph">${ICONS.key}</div>
        <div class="key-main">
          <div class="key-name-row">
            <span class="key-name">${esc(displayName)}</span>
            ${k.type ? `<span class="badge type">${esc(k.type.toUpperCase())}</span>` : ''}
            ${k.bits ? `<span class="badge">${esc(k.bits)} бит</span>` : ''}
            ${meta.alias ? `<span class="badge">${esc(k.name)}</span>` : ''}
          </div>
          <div class="key-sub">
            ${k.comment ? `<span>${esc(k.comment)}</span>` : ''}
            ${k.fingerprint ? `<span class="key-fp" title="${esc(k.fingerprint)}">${esc(k.fingerprint)}</span>` : ''}
          </div>
        </div>
        <div class="key-actions" data-stop="1">
          <button class="icon-btn" data-action="key-copy-pub" data-name="${esc(k.name)}" title="Скопировать публичный ключ">${ICONS.copy}</button>
          <button class="icon-btn" data-action="key-reveal" data-name="${esc(k.name)}" title="Показать в Finder">${ICONS.folder}</button>
          <button class="icon-btn" data-action="key-rename" data-name="${esc(k.name)}" title="Переименовать">${ICONS.pencil}</button>
          <button class="icon-btn danger" data-action="key-delete" data-name="${esc(k.name)}" title="Удалить">${ICONS.trash}</button>
          <button class="icon-btn" title="Подробнее">${ICONS.chevron}</button>
        </div>
      </div>
      <div class="key-detail">
        ${k.fingerprint ? `
        <div class="detail-row">
          <div class="detail-label">Отпечаток (SHA256)</div>
          <div class="detail-value">${esc(k.fingerprint)}</div>
        </div>` : ''}
        ${k.pub ? `
        <div class="detail-row">
          <div class="detail-label">Публичный ключ</div>
          <div class="detail-value">${esc(k.pub)}</div>
        </div>` : ''}
        <div class="detail-actions">
          ${k.pub ? `<button class="btn ghost" data-action="key-copy-pub" data-name="${esc(k.name)}">${ICONS.copy} Скопировать публичный ключ</button>` : ''}
          ${k.fingerprint ? `<button class="btn ghost" data-action="key-copy-fp" data-name="${esc(k.name)}">${ICONS.copy} Скопировать отпечаток</button>` : ''}
        </div>
      </div>
    </div>`;
}

function renderAliases() {
  const q = state.searchAliases.toLowerCase();
  const list = state.aliases.filter((a) => {
    const hay = (a.name + ' ' + a.hostName + ' ' + a.user + ' ' + a.identityFile).toLowerCase();
    return !q || hay.includes(q);
  });

  if (!list.length) {
    $('#aliases-list').innerHTML = emptyState(
      q ? 'Ничего не найдено' : 'Псевдонимов нет',
      q ? 'Измените запрос.' : 'Создайте псевдоним — и подключайтесь командой ssh alias.'
    );
    return;
  }

  $('#aliases-list').innerHTML = `<div class="alias-list">${list.map(aliasCard).join('')}</div>`;
}

function aliasCard(a) {
  const target = (a.user ? a.user + '@' : '') + (a.hostName || '—') + ((a.port && String(a.port) !== '22') ? ':' + a.port : '');
  return `
    <div class="card alias-card" data-alias="${esc(a.name)}">
      <div class="alias-main">
        <div class="alias-glyph">${ICONS.terminal}</div>
        <div class="alias-info">
          <div class="alias-name-row">
            <span class="alias-name mono">${esc(a.name)}</span>
            ${a.hostName ? `<span class="alias-target mono">${esc(target)}</span>` : ''}
          </div>
          <div class="alias-sub">
            ${a.identityFile ? `<span class="badge">🔑 ${esc(keyLabel(a.identityFile))}</span>` : ''}
            ${a.extraCount ? `<span class="badge">+${a.extraCount} доп. опций</span>` : ''}
          </div>
        </div>
        <div class="alias-actions">
          <button class="btn ghost" data-action="alias-copy-cmd" data-alias="${esc(a.name)}">${ICONS.copy} <span class="mono">ssh ${esc(a.name)}</span></button>
          <button class="icon-btn" data-action="alias-edit" data-alias="${esc(a.name)}" title="Редактировать">${ICONS.pencil}</button>
          <button class="icon-btn danger" data-action="alias-delete" data-alias="${esc(a.name)}" title="Удалить">${ICONS.trash}</button>
          <button class="btn primary" data-action="alias-connect" data-alias="${esc(a.name)}">${ICONS.terminal} Подключиться</button>
        </div>
      </div>
    </div>`;
}

function renderServers() {
  const groups = [...new Set((state.data.servers || []).map((s) => s.group).filter(Boolean))];
  const chips = ['all', ...groups].map((g) => `
    <button class="chip ${state.groupFilter === g ? 'active' : ''}" data-action="group-filter" data-group="${esc(g)}">
      ${g === 'all' ? 'Все' : esc(g)}
    </button>`).join('');
  $('#group-chips').innerHTML = chips;

  const q = state.searchServers.toLowerCase();
  let list = (state.data.servers || []).filter((s) => {
    const matchGroup = state.groupFilter === 'all' || (s.group || '') === state.groupFilter;
    const hay = (s.name + ' ' + s.host + ' ' + s.user + ' ' + (s.group || '') + ' ' + (s.notes || '')).toLowerCase();
    return matchGroup && (!q || hay.includes(q));
  });

  if (!list.length) {
    $('#servers-list').innerHTML = emptyState(
      q || state.groupFilter !== 'all' ? 'Ничего не найдено' : 'Серверов пока нет',
      q || state.groupFilter !== 'all' ? 'Измените фильтр или запрос.' : 'Добавьте первый сервер.'
    );
    return;
  }

  $('#servers-list').innerHTML = `<div class="server-grid">${list.map((s) => serverCard(s)).join('')}</div>`;
}

function serverCard(s) {
  const color = s.color || PALETTE[0];
  const addr = `${s.user ? s.user + '@' : ''}${s.host || '—'}${(s.port && Number(s.port) !== 22) ? ':' + s.port : ''}`;
  const authBadge = s.authMethod === 'password'
    ? '<span class="badge">🔒 Пароль</span>'
    : '<span class="badge">🔑 ' + esc(keyLabel(s.keyPath)) + '</span>';
  const hasAlias = !!serverHasAlias(s);
  return `
    <div class="card server-card" data-server-id="${esc(s.id)}">
      <div class="server-top">
        <div class="server-dot" style="background:${esc(color)}"></div>
        <div class="server-main">
          <div class="server-name">
            ${esc(s.name || 'Без имени')}
            ${s.group ? `<span class="badge">${esc(s.group)}</span>` : ''}
          </div>
          <div class="server-addr">${esc(addr)}</div>
          <div class="server-badges">${authBadge}</div>
        </div>
        <div class="server-actions" data-stop="1">
          <button class="icon-btn" data-action="server-edit" data-id="${esc(s.id)}" title="Редактировать">${ICONS.pencil}</button>
          <button class="icon-btn danger" data-action="server-delete" data-id="${esc(s.id)}" title="Удалить">${ICONS.trash}</button>
        </div>
      </div>
      <div class="server-foot">
        <button class="btn ghost${hasAlias ? ' has-alias' : ''}" data-action="server-alias" data-id="${esc(s.id)}" title="${hasAlias ? 'Редактировать псевдоним' : 'Создать псевдоним в ~/.ssh/config'}">${ICONS.tag} ${hasAlias ? 'Псевдоним ✓' : 'Псевдоним'}</button>
        <button class="btn ghost" data-action="server-copy-cmd" data-id="${esc(s.id)}">${ICONS.copy} Команда</button>
        <div class="spacer"></div>
        <button class="btn primary connect-btn" data-action="server-connect" data-id="${esc(s.id)}">${ICONS.terminal} Подключиться</button>
      </div>
    </div>`;
}

function keyLabel(keyPath) {
  if (!keyPath) return '—';
  const m = String(keyPath).match(/[^/]+$/);
  return m ? m[0] : keyPath;
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function serverHasAlias(server) {
  const slug = slugify(server.name || server.host);
  return state.aliases.find((a) =>
    a.name === slug || (a.hostName && a.hostName === server.host && a.user === server.user)
  ) || null;
}

function serverToAlias(server) {
  return {
    name: slugify(server.name || server.host) || 'server',
    hostName: server.host || '',
    user: server.user || '',
    port: server.port || '',
    identityFile: server.authMethod === 'key' ? server.keyPath : '',
    extra: ''
  };
}

function renderSettings() {
  $('#settings-datadir').textContent = $('#data-dir').title || $('#settings-datadir').textContent;
  $$('#theme-seg button').forEach((b) => b.classList.toggle('active', b.dataset.val === (state.data.settings.theme || 'system')));

  const pwTitle = $('#pw-title');
  const pwDesc = $('#pw-desc');
  const pwActions = $('#pw-actions');
  if (state.encrypted) {
    pwTitle.textContent = 'Пароль установлен';
    pwDesc.textContent = 'Хранилище зашифровано (AES-256-GCM).';
    pwActions.innerHTML = `
      <button class="btn ghost" data-action="change-password">Изменить</button>
      <button class="btn ghost" data-action="remove-password">Убрать</button>`;
  } else {
    pwTitle.textContent = 'Пароль не установлен';
    pwDesc.textContent = 'Серверы и секреты хранятся в открытом виде.';
    pwActions.innerHTML = `<button class="btn ghost" data-action="set-password">Установить пароль</button>`;
  }
}

function emptyState(title, sub) {
  return `<div class="empty">${ICONS.key}<h3>${esc(title)}</h3><p>${esc(sub)}</p></div>`;
}

/* ---------- clipboard ---------- */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Скопировано');
  } catch {
    toast('Не удалось скопировать', 'error');
  }
}

/* ---------- modals ---------- */
function openModal(html) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal">${html}</div></div>`;
  const backdrop = root.querySelector('.modal-backdrop');
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
  const first = root.querySelector('input:not([type=hidden]), select, textarea');
  if (first) setTimeout(() => first.focus(), 30);
  return root.querySelector('.modal');
}
function closeModal() { $('#modal-root').innerHTML = ''; }

function createKeyModal() {
  const m = openModal(`
    <h3>Новый SSH-ключ</h3>
    <div class="field"><label>Имя ключа</label><input id="mk-name" placeholder="production_ed25519"></div>
    <div class="field">
      <label>Тип ключа</label>
      <div class="segmented" id="mk-type">
        <button data-val="ed25519" class="active">Ed25519</button>
        <button data-val="rsa">RSA</button>
        <button data-val="ecdsa">ECDSA</button>
      </div>
    </div>
    <div class="field" id="mk-bits-wrap" hidden>
      <label>Размер ключа</label>
      <select id="mk-bits"></select>
    </div>
    <div class="field"><label>Комментарий</label><input id="mk-comment" placeholder="user@host (необязательно)"></div>
    <div class="field"><label>Парольная фраза</label><input type="password" id="mk-pass" placeholder="необязательно"></div>
    <div class="field"><label>Повторите фразу</label><input type="password" id="mk-pass2" placeholder="ещё раз"></div>
    <div class="modal-actions">
      <button class="btn" data-action="modal-close">Отмена</button>
      <button class="btn primary" id="mk-submit">Создать</button>
    </div>
  `);

  let type = 'ed25519';
  const setBitsOptions = () => {
    const sel = $('#mk-bits');
    if (type === 'ecdsa') sel.innerHTML = '<option value="256">256 бит</option><option value="384">384 бит</option><option value="521">521 бит</option>';
    else sel.innerHTML = '<option value="2048">2048 бит</option><option value="4096">4096 бит</option>';
  };
  $('#mk-type').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    type = b.dataset.val;
    $$('#mk-type button').forEach((x) => x.classList.toggle('active', x === b));
    $('#mk-bits-wrap').hidden = type === 'ed25519';
    setBitsOptions();
  });

  $('#mk-submit').addEventListener('click', async () => {
    const name = $('#mk-name').value.trim();
    const pass = $('#mk-pass').value;
    const pass2 = $('#mk-pass2').value;
    if (!name) return toast('Введите имя ключа', 'error');
    if (pass !== pass2) return toast('Парольные фразы не совпадают', 'error');
    try {
      await bridge.createKey({ name, type, bits: $('#mk-bits').value, comment: $('#mk-comment').value.trim(), passphrase: pass });
      closeModal();
      toast('Ключ создан');
      await refreshKeys();
      render();
    } catch (err) {
      toast(err.message || 'Ошибка', 'error');
    }
  });
}

function renameKeyModal(key) {
  const m = openModal(`
    <h3>Переименовать ключ</h3>
    <div class="field"><label>Текущее имя</label><div class="mono path">${esc(key.name)}</div></div>
    <div class="field"><label>Новое имя</label><input id="rk-name" value="${esc(key.name)}"></div>
    <div class="field"><p class="hint">Будут переименованы файлы ключа и <span class="mono">.pub</span>, а ссылки в <span class="mono">~/.ssh/config</span> обновлены.</p></div>
    <div class="modal-actions">
      <button class="btn" data-action="modal-close">Отмена</button>
      <button class="btn primary" id="rk-submit">Переименовать</button>
    </div>
  `);
  $('#rk-submit').addEventListener('click', async () => {
    const newName = $('#rk-name').value.trim();
    if (!newName) return toast('Введите новое имя', 'error');
    if (newName === key.name) return closeModal();
    try {
      await bridge.renameKey({ name: key.name, newName });
      // обновить ссылки в серверах
      const oldPath = '~/.ssh/' + key.name;
      const newPath = '~/.ssh/' + newName;
      let changed = false;
      state.data.servers.forEach((s) => {
        if (s.keyPath === oldPath) { s.keyPath = newPath; changed = true; }
      });
      if (changed) await persist();
      closeModal();
      toast('Ключ переименован');
      await refreshKeys();
      render();
    } catch (err) {
      toast(err.message || 'Ошибка', 'error');
    }
  });
}

function deleteKeyModal(key) {
  const m = openModal(`
    <h3>Удалить ключ?</h3>
    <p class="muted">Ключ <b>${esc(key.name)}</b> будет перемещён в Корзину. Это действие нельзя отменить.</p>
    <div class="modal-actions">
      <button class="btn" data-action="modal-close">Отмена</button>
      <button class="btn danger" id="dk-submit">Удалить</button>
    </div>
  `);
  $('#dk-submit').addEventListener('click', async () => {
    try {
      await bridge.deleteKey(key.name);
      closeModal();
      toast('Ключ перемещён в Корзину');
      await refreshKeys();
      render();
    } catch (err) {
      toast(err.message || 'Ошибка', 'error');
    }
  });
}

function serverModal(server) {
  const isEdit = !!server;
  const s = server || { name: '', group: '', host: '', port: 22, user: '', authMethod: 'key', keyPath: '', password: '', color: PALETTE[0], notes: '', extraArgs: '' };
  const groups = [...new Set(state.data.servers.map((x) => x.group).filter(Boolean))];

  const m = openModal(`
    <h3>${isEdit ? 'Редактировать сервер' : 'Новый сервер'}</h3>
    <div class="field-row">
      <div class="field"><label>Название</label><input id="s-name" value="${esc(s.name)}" placeholder="Production"></div>
      <div class="field"><label>Группа</label><input id="s-group" list="s-groups" value="${esc(s.group || '')}" placeholder="Работа"></div>
    </div>
    <datalist id="s-groups">${groups.map((g) => `<option value="${esc(g)}"></option>`).join('')}</datalist>
    <div class="field-row">
      <div class="field"><label>Хост</label><input id="s-host" value="${esc(s.host)}" placeholder="1.2.3.4"></div>
      <div class="field"><label>Порт</label><input id="s-port" type="number" value="${esc(s.port)}" placeholder="22"></div>
    </div>
    <div class="field"><label>Пользователь</label><input id="s-user" value="${esc(s.user)}" placeholder="root"></div>
    <div class="field">
      <label>Способ входа</label>
      <div class="segmented" id="s-auth">
        <button data-val="key" class="${s.authMethod !== 'password' ? 'active' : ''}">Ключ</button>
        <button data-val="password" class="${s.authMethod === 'password' ? 'active' : ''}">Пароль</button>
      </div>
    </div>
    <div class="field" id="s-key-wrap" ${s.authMethod === 'password' ? 'hidden' : ''}>
      <label>SSH-ключ</label>
      <select id="s-key">
        <option value="">— не выбран —</option>
        ${state.keys.map((k) => `<option value="~/.ssh/${esc(k.name)}" ${s.keyPath === '~/.ssh/' + k.name ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}
      </select>
    </div>
    <div class="field" id="s-pass-wrap" ${s.authMethod !== 'password' ? 'hidden' : ''}>
      <label>Пароль</label>
      <input type="password" id="s-pass" value="${esc(s.password || '')}" placeholder="пароль сервера">
    </div>
    <div class="field">
      <label>Цвет</label>
      <div class="swatches" id="s-color">${PALETTE.map((c) => `<div class="swatch ${c === s.color ? 'active' : ''}" data-color="${c}" style="background:${c}"></div>`).join('')}</div>
    </div>
    <div class="field"><label>Доп. аргументы SSH</label><input id="s-args" value="${esc(s.extraArgs || '')}" placeholder="например, -o ServerAliveInterval=60"></div>
    <div class="field"><label>Заметки</label><textarea id="s-notes" placeholder="заметки…">${esc(s.notes || '')}</textarea></div>
    <div class="modal-actions">
      <button class="btn" data-action="modal-close">Отмена</button>
      <button class="btn primary" id="s-submit">${isEdit ? 'Сохранить' : 'Добавить'}</button>
    </div>
  `);

  let auth = s.authMethod === 'password' ? 'password' : 'key';
  let color = s.color || PALETTE[0];

  $('#s-auth').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    auth = b.dataset.val;
    $$('#s-auth button').forEach((x) => x.classList.toggle('active', x === b));
    $('#s-key-wrap').hidden = auth === 'password';
    $('#s-pass-wrap').hidden = auth !== 'password';
  });
  $('#s-color').addEventListener('click', (e) => {
    const sw = e.target.closest('.swatch'); if (!sw) return;
    color = sw.dataset.color;
    $$('#s-color .swatch').forEach((x) => x.classList.toggle('active', x === sw));
  });

  $('#s-submit').addEventListener('click', async () => {
    const host = $('#s-host').value.trim();
    if (!host) return toast('Введите хост', 'error');
    const record = {
      id: s.id || 'sv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      name: $('#s-name').value.trim(),
      group: $('#s-group').value.trim(),
      host,
      port: $('#s-port').value || 22,
      user: $('#s-user').value.trim(),
      authMethod: auth,
      keyPath: auth === 'key' ? $('#s-key').value : '',
      password: auth === 'password' ? $('#s-pass').value : '',
      color,
      notes: $('#s-notes').value.trim(),
      extraArgs: $('#s-args').value.trim(),
      updatedAt: Date.now()
    };
    if (isEdit) {
      const idx = state.data.servers.findIndex((x) => x.id === s.id);
      if (idx >= 0) state.data.servers[idx] = record;
    } else {
      state.data.servers.push(record);
    }
    try {
      await persist();
      closeModal();
      toast(isEdit ? 'Сервер сохранён' : 'Сервер добавлен');
      render();
    } catch (err) {
      toast(err.message || 'Ошибка', 'error');
    }
  });
}

function deleteServerModal(server) {
  const m = openModal(`
    <h3>Удалить сервер?</h3>
    <p class="muted">Сервер <b>${esc(server.name || server.host)}</b> будет удалён из хранилища.</p>
    <div class="modal-actions">
      <button class="btn" data-action="modal-close">Отмена</button>
      <button class="btn danger" id="ds-submit">Удалить</button>
    </div>
  `);
  $('#ds-submit').addEventListener('click', async () => {
    state.data.servers = state.data.servers.filter((x) => x.id !== server.id);
    await persist();
    closeModal();
    toast('Сервер удалён');
    render();
  });
}

function aliasModal(alias) {
  const isEdit = !!alias;
  const a = alias || { name: '', hostName: '', user: '', port: '', identityFile: '', extra: '' };
  const keyOptions = state.keys.map((k) =>
    `<option value="~/.ssh/${esc(k.name)}" ${a.identityFile === '~/.ssh/' + k.name ? 'selected' : ''}>${esc(k.name)}</option>`
  ).join('');

  const m = openModal(`
    <h3>${isEdit ? 'Редактировать псевдоним' : 'Новый псевдоним'}</h3>
    <div class="field"><label>Псевдоним</label><input id="al-name" value="${esc(a.name)}" placeholder="main-server"><p class="hint">Команда подключения: <span class="mono">ssh ${esc(a.name) || 'alias'}</span></p></div>
    <div class="field"><label>Адрес (HostName)</label><input id="al-host" value="${esc(a.hostName)}" placeholder="1.2.3.4 или example.com"></div>
    <div class="field-row">
      <div class="field"><label>Пользователь</label><input id="al-user" value="${esc(a.user)}" placeholder="root"></div>
      <div class="field"><label>Порт</label><input id="al-port" type="number" value="${esc(a.port)}" placeholder="22"></div>
    </div>
    <div class="field"><label>SSH-ключ (IdentityFile)</label>
      <select id="al-key">
        <option value="">— не выбран —</option>
        ${keyOptions}
      </select>
    </div>
    <div class="field"><label>Доп. опции (по строке)</label><textarea id="al-extra" placeholder="ProxyJump jump-host\nLocalForward 8080 127.0.0.1:8080">${esc(a.extra || '')}</textarea></div>
    <div class="modal-actions">
      <button class="btn" data-action="modal-close">Отмена</button>
      <button class="btn primary" id="al-submit">${isEdit ? 'Сохранить' : 'Добавить'}</button>
    </div>
  `);

  $('#al-submit').addEventListener('click', async () => {
    const name = $('#al-name').value.trim();
    if (!name) return toast('Введите псевдоним', 'error');
    try {
      await bridge.saveHost({
        name,
        hostName: $('#al-host').value.trim(),
        user: $('#al-user').value.trim(),
        port: $('#al-port').value.trim(),
        identityFile: $('#al-key').value,
        extra: $('#al-extra').value
      });
      closeModal();
      toast(isEdit ? 'Псевдоним сохранён' : 'Псевдоним добавлен');
      await refreshAliases();
      render();
    } catch (err) { toast(err.message || 'Ошибка', 'error'); }
  });
}

function deleteAliasModal(alias) {
  const m = openModal(`
    <h3>Удалить псевдоним?</h3>
    <p class="muted">Запись <b>${esc(alias.name)}</b> будет удалена из <span class="mono">~/.ssh/config</span>.</p>
    <div class="modal-actions">
      <button class="btn" data-action="modal-close">Отмена</button>
      <button class="btn danger" id="al-del-submit">Удалить</button>
    </div>
  `);
  $('#al-del-submit').addEventListener('click', async () => {
    try {
      await bridge.deleteHost(alias.name);
      closeModal();
      toast('Псевдоним удалён');
      await refreshAliases();
      render();
    } catch (err) { toast(err.message || 'Ошибка', 'error'); }
  });
}

function masterPasswordModal() {
  const m = openModal(`
    <h3>Установить пароль</h3>
    <p class="muted">Пароль будет шифровать всё хранилище. Без него данные восстановить невозможно.</p>
    <div class="field"><label>Новый пароль</label><input type="password" id="pw-new" placeholder="минимум 6 символов"></div>
    <div class="field"><label>Повторите пароль</label><input type="password" id="pw-new2"></div>
    <div class="modal-actions">
      <button class="btn" data-action="modal-close">Отмена</button>
      <button class="btn primary" id="pw-submit">Установить</button>
    </div>
  `);
  $('#pw-submit').addEventListener('click', async () => {
    const p1 = $('#pw-new').value, p2 = $('#pw-new2').value;
    if (p1.length < 6) return toast('Пароль слишком короткий', 'error');
    if (p1 !== p2) return toast('Пароли не совпадают', 'error');
    try {
      await bridge.setMasterPassword({ current: '', next: p1 });
      state.encrypted = true;
      closeModal();
      toast('Пароль установлен');
      renderSettings();
    } catch (err) { toast(err.message, 'error'); }
  });
}

function changePasswordModal() {
  const m = openModal(`
    <h3>Изменить пароль</h3>
    <div class="field"><label>Текущий пароль</label><input type="password" id="pc-cur"></div>
    <div class="field"><label>Новый пароль</label><input type="password" id="pc-new" placeholder="минимум 6 символов"></div>
    <div class="field"><label>Повторите новый пароль</label><input type="password" id="pc-new2"></div>
    <div class="modal-actions">
      <button class="btn" data-action="modal-close">Отмена</button>
      <button class="btn primary" id="pc-submit">Изменить</button>
    </div>
  `);
  $('#pc-submit').addEventListener('click', async () => {
    const cur = $('#pc-cur').value, p1 = $('#pc-new').value, p2 = $('#pc-new2').value;
    if (p1.length < 6) return toast('Пароль слишком короткий', 'error');
    if (p1 !== p2) return toast('Пароли не совпадают', 'error');
    try {
      await bridge.setMasterPassword({ current: cur, next: p1 });
      state.encrypted = true;
      closeModal(); toast('Пароль изменён'); renderSettings();
    } catch (err) { toast(err.message, 'error'); }
  });
}

function removePasswordModal() {
  const m = openModal(`
    <h3>Убрать пароль</h3>
    <p class="muted">Хранилище будет сохранено без шифрования.</p>
    <div class="field"><label>Текущий пароль</label><input type="password" id="pr-cur"></div>
    <div class="modal-actions">
      <button class="btn" data-action="modal-close">Отмена</button>
      <button class="btn danger" id="pr-submit">Убрать пароль</button>
    </div>
  `);
  $('#pr-submit').addEventListener('click', async () => {
    try {
      await bridge.setMasterPassword({ current: $('#pr-cur').value, next: '' });
      state.encrypted = false;
      closeModal(); toast('Пароль убран'); renderSettings();
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ---------- actions ---------- */
async function connectServer(server) {
  try {
    const cmd = await bridge.connect(server);
    toast('Terminal запущен');
    void cmd;
  } catch (err) {
    toast(err.message || 'Не удалось запустить Terminal', 'error');
  }
}
async function copyServerCommand(server) {
  try {
    const cmd = await bridge.buildCommand(server);
    if (!cmd) return toast('Не заполнен адрес сервера', 'error');
    await copyText(cmd);
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ---------- global events ---------- */
document.addEventListener('click', async (e) => {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;

  if (action === 'modal-close') { closeModal(); return; }

  // не перехватывать клики внутри detail-actions / key-actions как toggle
  if (action === 'key-toggle') {
    const card = actionEl.closest('.key-card');
    if (e.target.closest('[data-stop]')) return;
    card.classList.toggle('open');
    return;
  }

  if (action === 'nav') {
    state.view = actionEl.dataset.view;
    render();
    return;
  }
  if (action === 'lock') {
    await bridge.lock();
    location.reload();
    return;
  }
  if (action === 'new-key') { createKeyModal(); return; }
  if (action === 'new-alias') { aliasModal(null); return; }
  if (action === 'new-server') { serverModal(null); return; }

  if (action === 'key-copy-pub' || action === 'key-copy-fp') {
    const name = actionEl.dataset.name;
    const key = state.keys.find((k) => k.name === name);
    if (!key) return;
    if (action === 'key-copy-pub') await copyText(key.pub || '');
    else await copyText(key.fingerprint || '');
    return;
  }
  if (action === 'key-reveal') { bridge.revealKey(actionEl.dataset.name); return; }
  if (action === 'key-rename') {
    const key = state.keys.find((k) => k.name === actionEl.dataset.name);
    if (key) renameKeyModal(key);
    return;
  }
  if (action === 'key-delete') {
    const key = state.keys.find((k) => k.name === actionEl.dataset.name);
    if (key) deleteKeyModal(key);
    return;
  }

  if (action === 'open-config') { bridge.openConfig(); return; }
  if (action === 'alias-connect') {
    const alias = actionEl.dataset.alias;
    try { await bridge.connectAlias(alias); toast('Terminal запущен'); }
    catch (err) { toast(err.message || 'Не удалось запустить Terminal', 'error'); }
    return;
  }
  if (action === 'alias-copy-cmd') {
    const alias = actionEl.dataset.alias;
    const cmd = await bridge.aliasCommand(alias);
    await copyText(cmd);
    return;
  }
  if (action === 'alias-edit') {
    const name = actionEl.dataset.alias;
    const full = await bridge.getHost(name);
    aliasModal(full || { name });
    return;
  }
  if (action === 'alias-delete') {
    deleteAliasModal({ name: actionEl.dataset.alias });
    return;
  }

  if (action === 'group-filter') {
    state.groupFilter = actionEl.dataset.group;
    render();
    return;
  }

  const findServer = (id) => (state.data.servers || []).find((s) => s.id === id);
  if (action === 'server-edit') { serverModal(findServer(actionEl.dataset.id)); return; }
  if (action === 'server-delete') { deleteServerModal(findServer(actionEl.dataset.id)); return; }
  if (action === 'server-connect') { connectServer(findServer(actionEl.dataset.id)); return; }
  if (action === 'server-copy-cmd') { copyServerCommand(findServer(actionEl.dataset.id)); return; }
  if (action === 'server-alias') {
    const server = findServer(actionEl.dataset.id);
    if (!server) return;
    const existing = serverHasAlias(server);
    if (existing) {
      const full = await bridge.getHost(existing.name);
      aliasModal(full || existing);
    } else {
      aliasModal(serverToAlias(server));
    }
    return;
  }

  // settings
  if (action === 'change-dir') {
    const res = await bridge.changeDataDir();
    if (res) {
      $('#data-dir').textContent = shorten(res);
      $('#data-dir').title = res;
      renderSettings();
      toast('Папка хранения изменена');
    }
    return;
  }
  if (action === 'open-dir') { bridge.openDataDir(); return; }
  if (action === 'open-ssh') { bridge.openSshFolder(); return; }
  if (action === 'export-backup') {
    const res = await bridge.exportBackup();
    if (res) toast('Резервная копия сохранена');
    return;
  }
  if (action === 'set-password') { masterPasswordModal(); return; }
  if (action === 'change-password') { changePasswordModal(); return; }
  if (action === 'remove-password') { removePasswordModal(); return; }

  if (action === 'theme') {
    state.data.settings.theme = actionEl.dataset.val;
    applyTheme(actionEl.dataset.val);
    await persist();
    renderSettings();
    return;
  }
});

// Поиск (input, без data-action)
document.addEventListener('input', (e) => {
  if (e.target.id === 'keys-search') { state.searchKeys = e.target.value; renderKeys(); }
  if (e.target.id === 'aliases-search') { state.searchAliases = e.target.value; renderAliases(); }
  if (e.target.id === 'servers-search') { state.searchServers = e.target.value; renderServers(); }
});

// Тема через segmented в настройках
document.addEventListener('click', (e) => {
  const b = e.target.closest('#theme-seg button');
  if (!b) return;
  state.data.settings.theme = b.dataset.val;
  applyTheme(b.dataset.val);
  persist();
  $$('#theme-seg button').forEach((x) => x.classList.toggle('active', x === b));
});

// Разблокировка
$('#unlock-btn').addEventListener('click', unlockHandler);
$('#unlock-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlockHandler(); });

async function unlockHandler() {
  const pw = $('#unlock-password').value;
  const data = await bridge.unlock(pw);
  if (data) {
    $('#unlock-error').textContent = '';
    $('#unlock-password').value = '';
    state.encrypted = true;
    state.data = normalizeData(data);
    applyTheme(state.data.settings.theme || 'system');
    await refreshKeys();
    await refreshAliases();
    render();
    $('#unlock').classList.add('hidden');
    $('#app').classList.remove('hidden');
  } else {
    $('#unlock-error').textContent = 'Неверный пароль';
    $('#unlock-password').select();
  }
}

init().catch((err) => {
  console.error('INIT ERROR:', err);
  toast('Ошибка запуска: ' + (err && err.message ? err.message : err), 'error');
});
