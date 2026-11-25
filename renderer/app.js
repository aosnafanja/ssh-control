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
  searchSnippets: '',
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
    settings: Object.assign({ theme: 'system' }, d.settings),
    snippets: Array.isArray(d.snippets) ? d.snippets : []
  };
}
async function persist() {
  await bridge.save(state.data);
}

/* ---------- shared screen helpers ---------- */
function keyLabel(keyPath) {
  if (!keyPath) return '—';
  const m = String(keyPath).match(/[^/]+$/);
  return m ? m[0] : keyPath;
}
function emptyState(title, sub) {
  return `<div class="empty">${ICONS.key}<h3>${esc(title)}</h3><p>${esc(sub)}</p></div>`;
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
  $('#snippets-count').textContent = (state.data.snippets || []).length;

  $$('.view').forEach((v) => v.classList.add('hidden'));
  $('#view-' + state.view).classList.remove('hidden');

  if (state.view === 'keys') renderKeys();
  else if (state.view === 'aliases') renderAliases();
  else if (state.view === 'servers') renderServers();
  else if (state.view === 'snippets') renderSnippets();
  else if (state.view === 'settings') renderSettings();
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

/* ---------- edit-команды из главного меню ---------- */
// xterm.js хранит выделение вне DOM-selection, поэтому нативные роли Edit его не
// копируют и не выделяют (#45). Меню присылает команды сюда: терминал обрабатывает
// свои панели сам (window.Term.editCommand), остальные поля — DOM-командами.
function handleEditCommand(command, text) {
  if (window.Term && window.Term.editCommand && window.Term.editCommand(command, text)) return;
  const el = document.activeElement;
  if (command === 'select-all') { document.execCommand('selectAll'); return; }
  if (command === 'cut') { cutSelection(el); return; }
  if (command === 'copy') { document.execCommand('copy'); return; }
  if (command === 'paste' && el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
    document.execCommand('insertText', false, text || '');
  }
}

// execCommand('cut') в Electron не срабатывает без доверенного пользовательского
// события, поэтому вырезание в полях делаем вручную: буфер + удаление выделения.
function cutSelection(el) {
  if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') || typeof el.selectionStart !== 'number') {
    document.execCommand('cut');
    return;
  }
  const start = el.selectionStart;
  const end = el.selectionEnd;
  if (start === end) return;
  copyText(el.value.slice(start, end));
  el.setRangeText('', start, end, 'end');
  el.dispatchEvent(new Event('input', { bubbles: true }));
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

function restoreBackupConfirm() {
  openModal(`
    <h3>Восстановить из копии?</h3>
    <p class="muted">Текущие данные будут заменены данными из выбранного файла. Это необратимо.</p>
    <div class="modal-actions">
      <button class="btn" data-action="modal-close">Отмена</button>
      <button class="btn primary" data-action="restore-backup-confirm">Восстановить</button>
    </div>
  `);
}

function exportKeysBackupModal() {
  openModal(`
    <h3>Экспорт ключей</h3>
    <p class="muted">Ключи и конфигурация ~/.ssh будут сохранены в зашифрованный файл. Введите пароль для копии.</p>
    <div class="field"><label>Пароль</label><input type="password" id="ekb-pass" placeholder="пароль"></div>
    <div class="field"><label>Повторите пароль</label><input type="password" id="ekb-pass2" placeholder="ещё раз"></div>
    <div class="form-error" id="ekb-error"></div>
    <div class="modal-actions">
      <button class="btn" data-action="modal-close">Отмена</button>
      <button class="btn primary" data-action="export-keys-backup-confirm">Экспортировать</button>
    </div>
  `);
}

/* ---------- actions ---------- */
function connectServer(server) {
  window.Term.openServer(server);
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
    window.Term.openAlias(actionEl.dataset.alias);
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
  if (action === 'restore-backup') { restoreBackupConfirm(); return; }
  if (action === 'restore-backup-confirm') {
    try {
      const res = await bridge.restoreBackup();
      closeModal();
      if (res) { toast('Данные восстановлены'); location.reload(); }
    } catch (err) { toast(err.message || 'Ошибка', 'error'); closeModal(); }
    return;
  }
  if (action === 'export-keys-backup') { exportKeysBackupModal(); return; }
  if (action === 'export-keys-backup-confirm') {
    const p1 = $('#ekb-pass').value;
    const p2 = $('#ekb-pass2').value;
    const errEl = $('#ekb-error');
    if (!p1) { if (errEl) errEl.textContent = 'Введите пароль'; return; }
    if (p1 !== p2) { if (errEl) errEl.textContent = 'Пароли не совпадают'; return; }
    try {
      const res = await bridge.exportKeysBackup(p1);
      if (res) { closeModal(); toast('Копия ключей сохранена (' + res.count + ' файлов)'); }
    } catch (err) { if (errEl) errEl.textContent = err.message || 'Ошибка'; }
    return;
  }
  if (action === 'set-password') { masterPasswordModal(); return; }
  if (action === 'change-password') { changePasswordModal(); return; }
  if (action === 'remove-password') { removePasswordModal(); return; }

  // snippets
  if (action === 'new-snippet') { snippetModal(null); return; }
  if (action === 'snippet-edit') {
    const sn = (state.data.snippets || []).find((x) => x.id === actionEl.dataset.id);
    if (sn) snippetModal(sn);
    return;
  }
  if (action === 'snippet-delete') {
    const sn = (state.data.snippets || []).find((x) => x.id === actionEl.dataset.id);
    if (sn) deleteSnippetModal(sn);
    return;
  }

  if (action === 'theme') {
    state.data.settings.theme = actionEl.dataset.val;
    applyTheme(actionEl.dataset.val);
    await persist();
    renderSettings();
    return;
  }
});

// Esc закрывает модалку
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#modal-root').innerHTML) closeModal();
});

// Поиск (input, без data-action)
document.addEventListener('input', (e) => {
  if (e.target.id === 'keys-search') { state.searchKeys = e.target.value; renderKeys(); }
  if (e.target.id === 'aliases-search') { state.searchAliases = e.target.value; renderAliases(); }
  if (e.target.id === 'servers-search') { state.searchServers = e.target.value; renderServers(); }
  if (e.target.id === 'snippets-search') { state.searchSnippets = e.target.value; renderSnippets(); }
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

bridge.onEditCommand(handleEditCommand);

init().catch((err) => {
  console.error('INIT ERROR:', err);
  toast('Ошибка запуска: ' + (err && err.message ? err.message : err), 'error');
});
