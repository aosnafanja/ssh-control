'use strict';

function newSnippetId() {
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function snippetRow(s) {
  return `
    <div class="card snippet-card">
      <div class="snippet-main">
        <div class="snippet-glyph">${ICONS.terminal}</div>
        <div class="snippet-info">
          <div class="snippet-name-row">
            <span class="snippet-name">${esc(s.name)}</span>
          </div>
          <div class="snippet-command" title="${esc(s.command)}">${esc(s.command)}</div>
        </div>
        <div class="snippet-actions">
          <button class="icon-btn" data-action="snippet-edit" data-id="${esc(s.id)}" title="Изменить" aria-label="Изменить">${ICONS.pencil}</button>
          <button class="icon-btn danger" data-action="snippet-delete" data-id="${esc(s.id)}" title="Удалить" aria-label="Удалить">${ICONS.trash}</button>
        </div>
      </div>
    </div>`;
}

function renderSnippets() {
  const q = state.searchSnippets.toLowerCase();
  const list = (state.data.snippets || []).filter((s) => {
    const hay = (s.name + ' ' + s.command).toLowerCase();
    return !q || hay.includes(q);
  });

  if (!list.length) {
    $('#snippets-list').innerHTML = `<div class="empty">${ICONS.terminal}<h3>${esc(q ? 'Ничего не найдено' : 'Сниппетов пока нет')}</h3><p>${esc(q ? 'Измените запрос.' : 'Добавьте первую команду.')}</p></div>`;
    return;
  }

  $('#snippets-list').innerHTML = `<div class="snippet-list">${list.map(snippetRow).join('')}</div>`;
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
      render();
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
      render();
      if (window.Term && window.Term.renderSnippets) window.Term.renderSnippets();
    } catch (err) { toast(err.message || 'Ошибка', 'error'); }
  });
}
