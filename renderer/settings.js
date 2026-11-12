'use strict';

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

  renderSnippets();
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

/* ---------- snippets ---------- */
function newSnippetId() {
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function snippetRow(s) {
  return `
    <div class="setting-row">
      <div class="setting-info">
        <div class="setting-title">${esc(s.name)}</div>
        <div class="mono snippet-command" title="${esc(s.command)}">${esc(s.command)}</div>
      </div>
      <div class="setting-actions">
        <button class="icon-btn" data-action="snippet-edit" data-id="${esc(s.id)}" title="Изменить" aria-label="Изменить">${ICONS.pencil}</button>
        <button class="icon-btn danger" data-action="snippet-delete" data-id="${esc(s.id)}" title="Удалить" aria-label="Удалить">${ICONS.trash}</button>
      </div>
    </div>`;
}

function renderSnippets() {
  const box = $('#snippets-list');
  if (!box) return;
  const snippets = state.data.snippets || [];
  if (!snippets.length) {
    box.innerHTML = '<div class="snippet-empty muted">Нет сниппетов — добавьте первую команду.</div>';
    return;
  }
  box.innerHTML = snippets.map(snippetRow).join('');
}

function snippetModal(snippet) {
  const isEdit = !!snippet;
  const s = snippet || { id: '', name: '', command: '' };
  const m = openModal(`
    <h3>${isEdit ? 'Изменить сниппет' : 'Новый сниппет'}</h3>
    <div class="field"><label>Имя</label><input id="sn-name" value="${esc(s.name)}" placeholder="например, перезапуск nginx"></div>
    <div class="field"><label>Команда</label><textarea id="sn-command" placeholder="sudo systemctl restart nginx">${esc(s.command)}</textarea></div>
    <div class="modal-actions">
      <button class="btn" data-action="modal-close">Отмена</button>
      <button class="btn primary" id="sn-submit">${isEdit ? 'Сохранить' : 'Добавить'}</button>
    </div>
  `);
  $('#sn-submit').addEventListener('click', async () => {
    const name = $('#sn-name').value.trim();
    const command = $('#sn-command').value.trim();
    if (!name) return toast('Введите имя сниппета', 'error');
    if (!command) return toast('Введите команду', 'error');
    if (isEdit) {
      const idx = state.data.snippets.findIndex((x) => x.id === s.id);
      if (idx >= 0) state.data.snippets[idx] = { id: s.id, name, command };
    } else {
      state.data.snippets.push({ id: newSnippetId(), name, command });
    }
    try {
      await persist();
      closeModal();
      toast(isEdit ? 'Сниппет сохранён' : 'Сниппет добавлен');
      renderSnippets();
      if (window.Term && window.Term.renderSnippets) window.Term.renderSnippets();
    } catch (err) { toast(err.message || 'Ошибка', 'error'); }
  });
}

function deleteSnippetModal(snippet) {
  const m = openModal(`
    <h3>Удалить сниппет?</h3>
    <p class="muted">Сниппет <b>${esc(snippet.name)}</b> будет удалён из хранилища.</p>
    <div class="modal-actions">
      <button class="btn" data-action="modal-close">Отмена</button>
      <button class="btn danger" id="dsn-submit">Удалить</button>
    </div>
  `);
  $('#dsn-submit').addEventListener('click', async () => {
    state.data.snippets = state.data.snippets.filter((x) => x.id !== snippet.id);
    try {
      await persist();
      closeModal();
      toast('Сниппет удалён');
      renderSnippets();
      if (window.Term && window.Term.renderSnippets) window.Term.renderSnippets();
    } catch (err) { toast(err.message || 'Ошибка', 'error'); }
  });
}
